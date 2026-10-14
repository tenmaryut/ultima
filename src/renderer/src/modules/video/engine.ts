import type { Clip, Project } from './types';
import { Compositor, frameNeeds, type FrameProvider } from './compositor';
import type { MediaLibrary } from './media';
import type { TimeStore } from './timeStore';
import { getAudioContext } from '../../core/utils/audio';
import { clipEnd, timelineDuration, tracksOfKind } from './model';
import { audibleClips, clipGainAt } from './mix';
import { animatedLowPass, sourceAt, speedAt } from './keyframes';
import { buildChain, chainKey, type FxChain } from './audiofx';

/**
 * Real-time preview. Time is driven by performance.now(); <video>/<audio> elements are
 * re-synced to it every frame (seeking when they drift). Audio goes through Web Audio gain
 * nodes for volume (incl. boosts above 0 dB) and fades.
 */

const MAX_VIDEO_SLOTS = 12;
const MAX_AUDIO_SLOTS = 16;
const PREROLL = 1;
const IDLE_EVICT_MS = 6000;

interface VideoSlot {
  clipId: string;
  url: string;
  el: HTMLVideoElement;
  lastUsed: number;
  snapshot: HTMLCanvasElement | null;
  snapValid: boolean;
}

interface AudioSlot {
  clipId: string;
  url: string;
  el: HTMLAudioElement;
  source: MediaElementAudioSourceNode;
  gain: GainNode;
  /** The clip's sound effects after the gain (null without effects). */
  chain: FxChain | null;
  chainKey: string;
  lastUsed: number;
}

export interface EngineCallbacks {
  onPlayState: (playing: boolean, rate: number) => void;
  /** Called after every drawn frame (overlays). */
  onDraw?: () => void;
  offlineLabel: () => string;
}

export class PreviewEngine {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private compositor = new Compositor();
  private project: Project | null = null;
  private audible: Clip[] = [];
  private video = new Map<string, VideoSlot>();
  private audio = new Map<string, AudioSlot>();
  private host: HTMLDivElement;
  private raf = 0;
  private playing = false;
  private rate = 1;
  private wallStart = 0;
  private timeStart = 0;
  private active = true;
  private forceResync = false;
  private frameUsed = new Set<string>();
  private master: GainNode | null = null;
  private unsubscribe: () => void;
  loop = false;
  /** Canvas pixels per project pixel. */
  scale = 1;

  constructor(
    private lib: MediaLibrary,
    private time: TimeStore,
    private cb: EngineCallbacks,
  ) {
    this.host = document.createElement('div');
    Object.assign(this.host.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      width: '2px',
      height: '2px',
      overflow: 'hidden',
      opacity: '0.01',
      pointerEvents: 'none',
      zIndex: '-1',
    });
    this.unsubscribe = lib.subscribe(() => this.invalidate());
  }

  attach(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    (canvas.parentElement ?? document.body).appendChild(this.host);
    this.invalidate();
  }

  setProject(p: Project): void {
    this.project = p;
    this.audible = audibleClips(p);
    const ids = new Set(p.clips.map((c) => c.id));
    for (const [id, slot] of this.video) if (!ids.has(id)) this.destroyVideo(id, slot);
    for (const [id, slot] of this.audio) if (!ids.has(id)) this.destroyAudio(id, slot);
    this.forceResync = true;
    this.invalidate();
  }

  setScale(scale: number): void {
    if (Math.abs(scale - this.scale) < 1e-6) return;
    this.scale = scale;
    this.invalidate();
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get playbackRate(): number {
    return this.playing ? this.rate : 0;
  }

  get canvasElement(): HTMLCanvasElement | null {
    return this.canvas;
  }

  invalidate(): void {
    if (!this.raf && this.active && this.canvas) this.raf = requestAnimationFrame(this.tick);
  }

  private playRange(): [number, number] {
    const p = this.project;
    if (!p) return [0, 0];
    if (this.loop && p.workArea) return [p.workArea.start, p.workArea.end];
    return [0, timelineDuration(p)];
  }

  seek(t: number): void {
    const time = Math.max(0, Number.isFinite(t) ? t : 0);
    this.time.set(time);
    if (this.playing) {
      this.wallStart = performance.now();
      this.timeStart = time;
      this.forceResync = true;
    }
    this.invalidate();
  }

  play(rate = 1): void {
    if (!this.project) return;
    const [lo, hi] = this.playRange();
    if (hi - lo < 1e-3) return;
    let t = this.time.get();
    if (rate > 0 && (t >= hi - 1e-3 || t < lo - 1e-3)) t = lo;
    if (rate < 0 && (t <= lo + 1e-3 || t > hi + 1e-3)) t = hi;
    void getAudioContext()
      .resume()
      .catch(() => undefined);
    this.playing = true;
    this.rate = rate;
    this.wallStart = performance.now();
    this.timeStart = t;
    this.time.set(t);
    this.forceResync = true;
    this.cb.onPlayState(true, rate);
    this.invalidate();
  }

  pause(): void {
    if (!this.playing) return;
    this.stopPlayback();
    this.invalidate();
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play(1);
  }

  /** J / K / L shuttle. */
  shuttle(key: 'j' | 'k' | 'l'): void {
    if (key === 'k') return this.pause();
    if (key === 'l') this.play(this.playing && this.rate > 0 ? Math.min(8, this.rate * 2) : 1);
    else this.play(this.playing && this.rate < 0 ? Math.max(-8, this.rate * 2) : -1);
  }

  step(frames: number): void {
    if (!this.project) return;
    this.pause();
    const fps = this.project.settings.fps;
    const frame = Math.round(this.time.get() * fps) + frames;
    this.seek(Math.max(0, frame) / fps);
  }

  setActive(active: boolean): void {
    this.active = active;
    if (!active) {
      if (this.playing) this.stopPlayback();
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = 0;
    } else this.invalidate();
  }

  dispose(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.playing = false;
    for (const [id, s] of this.video) this.destroyVideo(id, s);
    for (const [id, s] of this.audio) this.destroyAudio(id, s);
    this.master?.disconnect();
    this.master = null;
    this.host.remove();
    this.unsubscribe();
  }

  private stopPlayback() {
    this.playing = false;
    for (const s of this.video.values()) if (!s.el.paused) s.el.pause();
    for (const s of this.audio.values()) {
      if (!s.el.paused) s.el.pause();
      s.gain.gain.value = 0;
    }
    this.cb.onPlayState(false, 0);
  }

  private tick = (now: number) => {
    this.raf = 0;
    if (!this.active || !this.project || !this.ctx) return;
    let t = this.time.get();
    if (this.playing) {
      t = this.timeStart + ((now - this.wallStart) / 1000) * this.rate;
      const [lo, hi] = this.playRange();
      if (this.rate > 0 && t >= hi) {
        if (this.loop && hi - lo > 0.05) {
          t = lo;
          this.wallStart = now;
          this.timeStart = lo;
          this.forceResync = true;
        } else {
          t = hi;
          this.stopPlayback();
        }
      } else if (this.rate < 0 && t <= lo) {
        t = lo;
        this.stopPlayback();
      }
      this.time.set(t);
    }
    this.sync(t);
    this.draw(t);
    if (this.playing) this.raf = requestAnimationFrame(this.tick);
  };

  /* ------------------------------ media elements ------------------------------ */

  private videoSlot(clip: Clip): VideoSlot | null {
    const item = this.lib.get(clip.mediaId);
    if (!item || !item.playable) return null;
    let slot = this.video.get(clip.id);
    if (slot && slot.url !== item.url) {
      this.destroyVideo(clip.id, slot);
      slot = undefined;
    }
    if (!slot) {
      const el = document.createElement('video');
      el.muted = true;
      el.playsInline = true;
      el.preload = 'auto';
      el.disablePictureInPicture = true;
      el.style.width = '2px';
      el.style.height = '2px';
      const redraw = () => {
        if (!this.playing) this.invalidate();
      };
      el.addEventListener('loadeddata', redraw);
      el.addEventListener('seeked', redraw);
      el.addEventListener('canplay', redraw);
      el.src = item.url;
      this.host.appendChild(el);
      slot = { clipId: clip.id, url: item.url, el, lastUsed: performance.now(), snapshot: null, snapValid: false };
      this.video.set(clip.id, slot);
    }
    return slot;
  }

  private destroyVideo(id: string, slot: VideoSlot) {
    slot.el.pause();
    slot.el.removeAttribute('src');
    slot.el.load();
    slot.el.remove();
    this.video.delete(id);
  }

  private masterGain(): GainNode {
    if (!this.master) {
      const ctx = getAudioContext();
      this.master = ctx.createGain();
      this.master.connect(ctx.destination);
    }
    return this.master;
  }

  private audioSlot(clip: Clip): AudioSlot | null {
    const item = this.lib.get(clip.mediaId);
    if (!item || !item.playable) return null;
    let slot = this.audio.get(clip.id);
    if (slot && slot.url !== item.url) {
      this.destroyAudio(clip.id, slot);
      slot = undefined;
    }
    if (!slot) {
      const ctx = getAudioContext();
      const el = new Audio();
      el.preload = 'auto';
      el.src = item.url;
      let source: MediaElementAudioSourceNode;
      try {
        source = ctx.createMediaElementSource(el);
      } catch {
        return null;
      }
      const gain = ctx.createGain();
      gain.gain.value = 0;
      source.connect(gain);
      gain.connect(this.masterGain());
      slot = { clipId: clip.id, url: item.url, el, source, gain, chain: null, chainKey: '', lastUsed: performance.now() };
      this.audio.set(clip.id, slot);
    }
    this.updateChain(slot, clip);
    return slot;
  }

  /** Rebuilds a slot's effect chain when the clip's effects changed (gain → effects → master). */
  private updateChain(slot: AudioSlot, clip: Clip) {
    const key = chainKey(clip);
    if (key === slot.chainKey) return;
    slot.gain.disconnect();
    slot.chain?.dispose();
    slot.chain = buildChain(getAudioContext(), clip);
    slot.chainKey = key;
    if (slot.chain) {
      slot.gain.connect(slot.chain.input);
      slot.chain.output.connect(this.masterGain());
    } else slot.gain.connect(this.masterGain());
  }

  private destroyAudio(id: string, slot: AudioSlot) {
    slot.el.pause();
    try {
      slot.source.disconnect();
      slot.gain.disconnect();
      slot.chain?.dispose();
    } catch {
      // already disconnected
    }
    slot.el.removeAttribute('src');
    slot.el.load();
    this.audio.delete(id);
  }

  private syncElement(el: HTMLMediaElement, st: number, speed: number, play: boolean, force: boolean, fps: number) {
    if (el.readyState < 1) return;
    const dur = el.duration;
    const atEnd = Number.isFinite(dur) && st >= dur - 0.04;
    if (play && !atEnd) {
      const pr = Math.max(0.0625, Math.min(16, speed * this.rate));
      if (Math.abs(el.playbackRate - pr) > 1e-3) el.playbackRate = pr;
      const drift = el.currentTime - st;
      if (el.paused) {
        if (Math.abs(drift) > 0.04) el.currentTime = st;
        void el.play().catch(() => undefined);
      } else if ((force && Math.abs(drift) > 0.02) || Math.abs(drift) > 0.15 * Math.max(1, this.rate)) {
        el.currentTime = st;
      }
    } else {
      if (!el.paused) el.pause();
      const target = atEnd ? Math.max(0, dur - 0.04) : st;
      if (Math.abs(el.currentTime - target) > 0.5 / fps) el.currentTime = target + 0.001;
    }
  }

  private sync(t: number) {
    const p = this.project!;
    const now = performance.now();
    const fps = p.settings.fps;
    const forward = this.playing && this.rate > 0;
    const force = this.forceResync;
    this.forceResync = false;

    const used = new Set<string>();
    for (const n of frameNeeds(p, t)) {
      const slot = this.videoSlot(n.clip);
      if (!slot) continue;
      used.add(n.clip.id);
      slot.lastUsed = now;
      // a <video> can't play backwards or stand still while playing: seek frame by frame instead
      const stepped = Boolean(n.clip.reverse || n.clip.freeze);
      this.syncElement(slot.el, n.sourceTime, speedAt(n.clip, t - n.clip.start), forward && !stepped, force, fps);
    }
    if (forward) {
      const visible = new Set(tracksOfKind(p, 'video').filter((tr) => !tr.hidden).map((tr) => tr.id));
      for (const c of p.clips) {
        if (c.kind !== 'video' || !visible.has(c.trackId) || used.has(c.id) || c.start <= t || c.start > t + PREROLL) continue;
        const slot = this.videoSlot(c);
        if (!slot) continue;
        used.add(c.id);
        slot.lastUsed = now;
        if (!slot.el.paused) slot.el.pause();
        const first = sourceAt(c, 0);
        if (slot.el.readyState >= 1 && Math.abs(slot.el.currentTime - first) > 0.05) slot.el.currentTime = first;
      }
    }
    for (const [id, slot] of this.video) if (!used.has(id) && !slot.el.paused) slot.el.pause();
    this.frameUsed = used;

    const heard = new Set<string>();
    if (forward && this.rate <= 4) {
      const actx = getAudioContext();
      for (const c of this.audible) {
        // reversed and frozen sound is only in the export
        if (c.start - PREROLL > t || clipEnd(c) <= t || c.reverse || c.freeze) continue;
        const slot = this.audioSlot(c);
        if (!slot) continue;
        heard.add(c.id);
        slot.lastUsed = now;
        if (t >= c.start) {
          slot.el.preservesPitch = c.keepPitch && !c.speedKeys?.length;
          this.syncElement(slot.el, sourceAt(c, t - c.start), speedAt(c, t - c.start), true, force, fps);
          slot.gain.gain.setTargetAtTime(clipGainAt(c, t), actx.currentTime, 0.015);
          if (slot.chain?.lowPass && c.keys?.lowPass?.length) slot.chain.lowPass.frequency.setTargetAtTime(animatedLowPass(c, t - c.start), actx.currentTime, 0.02);
        } else {
          if (!slot.el.paused) slot.el.pause();
          slot.gain.gain.value = 0;
          if (slot.el.readyState >= 1 && Math.abs(slot.el.currentTime - c.in) > 0.05) slot.el.currentTime = c.in;
        }
      }
    }
    for (const [id, slot] of this.audio) {
      if (heard.has(id)) continue;
      if (!slot.el.paused) slot.el.pause();
      slot.gain.gain.value = 0;
    }
    this.evict(now, used, heard);
  }

  private evict(now: number, usedVideo: Set<string>, usedAudio: Set<string>) {
    const prune = <S extends { lastUsed: number }>(map: Map<string, S>, used: Set<string>, max: number, destroy: (id: string, s: S) => void) => {
      for (const [id, s] of map) if (!used.has(id) && now - s.lastUsed > IDLE_EVICT_MS) destroy(id, s);
      if (map.size > max) {
        const idle = [...map].filter(([id]) => !used.has(id)).sort((a, b) => a[1].lastUsed - b[1].lastUsed);
        for (const [id, s] of idle.slice(0, map.size - max)) destroy(id, s);
      }
    };
    prune(this.video, usedVideo, MAX_VIDEO_SLOTS, (id, s) => this.destroyVideo(id, s));
    prune(this.audio, usedAudio, MAX_AUDIO_SLOTS, (id, s) => this.destroyAudio(id, s));
  }

  /* ---------------------------------- drawing --------------------------------- */

  private provider: FrameProvider = {
    video: (clip) => {
      const slot = this.video.get(clip.id);
      if (!slot) return null;
      const el = slot.el;
      if (el.readyState >= 2 && (!el.seeking || !slot.snapValid)) return el;
      return slot.snapValid ? slot.snapshot : null;
    },
    image: (id) => this.lib.image(id),
  };

  private draw(t: number) {
    if (!this.ctx || !this.project) return;
    this.compositor.render(this.ctx, this.project, t, this.provider, {
      scale: this.scale,
      captions: true,
      isOffline: (id) => !this.lib.has(id),
      offlineLabel: this.cb.offlineLabel(),
    });
    if (!this.playing) {
      // keep the last good frame of each element so scrubbing never flashes black
      for (const [id, slot] of this.video) {
        if (!this.frameUsed.has(id)) continue;
        const el = slot.el;
        if (el.readyState < 2 || el.seeking || !el.videoWidth) continue;
        const w = Math.min(960, el.videoWidth);
        const h = Math.max(1, Math.round((w * el.videoHeight) / el.videoWidth));
        if (!slot.snapshot) slot.snapshot = document.createElement('canvas');
        if (slot.snapshot.width !== w || slot.snapshot.height !== h) {
          slot.snapshot.width = w;
          slot.snapshot.height = h;
        }
        slot.snapshot.getContext('2d')?.drawImage(el, 0, 0, w, h);
        slot.snapValid = true;
      }
    }
    this.cb.onDraw?.();
  }
}
