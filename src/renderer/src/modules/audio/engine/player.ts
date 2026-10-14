/**
 * Streaming playback through Web Audio. Audio is pulled from a `PlaySource` in short
 * chunks that are scheduled back-to-back slightly ahead of time, so playback starts
 * instantly even for hour-long files, the source can be swapped while playing (live
 * effect preview, multitrack mixing) and meters read exactly what is being heard.
 * The AudioContext runs at the source's sample rate, so chunk boundaries are seamless.
 */

export interface PlaySource {
  sampleRate: number;
  /** Output channels (1 or 2). */
  channelCount: number;
  length: number;
  /** Returns `count` frames starting at `start` (fresh arrays, zero-padded past the end). */
  read(start: number, count: number): Float32Array[];
}

export interface PlayOptions {
  from: number;
  /** Exclusive end frame (default: source length). */
  to?: number;
  loop?: { start: number; end: number } | null;
  /** Added to reported positions (e.g. a preview buffer that starts at doc frame X). */
  offset?: number;
}

interface Scheduled {
  node: AudioBufferSourceNode;
  time: number;
  frame: number;
  frames: number;
  data: Float32Array[];
}

const CHUNK_FRAMES = 4096;

export class ChunkPlayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private scheduled: Scheduled[] = [];
  private source: PlaySource | null = null;
  private nextFrame = 0;
  private nextTime = 0;
  private endFrame = 0;
  private loop: { start: number; end: number } | null = null;
  private offset = 0;
  private finished = false;
  private gain = 1;
  /** Called when playback reaches the end (not when stopped). */
  onEnded: (() => void) | null = null;

  get playing(): boolean {
    return Boolean(this.timer);
  }

  get context(): AudioContext | null {
    return this.ctx;
  }

  setVolume(gain: number): void {
    this.gain = gain;
    if (this.master) this.master.gain.value = gain;
  }

  private async ensureContext(sampleRate: number): Promise<AudioContext> {
    if (this.ctx && this.ctx.state !== 'closed' && this.ctx.sampleRate === sampleRate) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return this.ctx;
    }
    if (this.ctx && this.ctx.state !== 'closed') void this.ctx.close().catch(() => undefined);
    let ctx: AudioContext;
    try {
      ctx = new AudioContext({ sampleRate, latencyHint: 'interactive' });
    } catch {
      ctx = new AudioContext({ latencyHint: 'interactive' }); // the browser resamples chunks
    }
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.gain;
    this.master.connect(ctx.destination);
    if (ctx.state === 'suspended') await ctx.resume();
    return ctx;
  }

  async play(source: PlaySource, options: PlayOptions): Promise<void> {
    this.stopNodes();
    const ctx = await this.ensureContext(source.sampleRate);
    this.source = source;
    this.loop = options.loop && options.loop.end - options.loop.start > 64 ? options.loop : null;
    this.offset = options.offset ?? 0;
    this.endFrame = this.loop ? this.loop.end : Math.min(source.length, options.to ?? source.length);
    this.nextFrame = Math.max(0, Math.min(options.from, this.endFrame));
    if (this.loop && (this.nextFrame < this.loop.start || this.nextFrame >= this.loop.end)) this.nextFrame = this.loop.start;
    this.nextTime = ctx.currentTime + 0.04;
    this.finished = false;
    this.schedule();
    this.timer = setInterval(() => this.schedule(), 25);
  }

  /** Swaps the source while playing (already scheduled audio still plays out). */
  setSource(source: PlaySource): void {
    if (!this.source) return;
    this.source = source;
    if (this.loop) this.loop = { start: Math.min(this.loop.start, source.length), end: Math.min(this.loop.end, source.length) };
    this.endFrame = Math.min(this.endFrame, source.length);
  }

  setLoop(loop: { start: number; end: number } | null): void {
    if (!this.source) return;
    this.loop = loop && loop.end - loop.start > 64 ? loop : null;
    this.endFrame = this.loop ? this.loop.end : this.source.length;
  }

  private schedule(): void {
    const ctx = this.ctx;
    const source = this.source;
    if (!ctx || !source || !this.master) return;
    const ahead = typeof document !== 'undefined' && document.hidden ? 2.5 : 0.3;
    const sr = source.sampleRate;
    while (!this.finished && this.nextTime < ctx.currentTime + ahead) {
      if (this.nextFrame >= this.endFrame) {
        if (this.loop) this.nextFrame = this.loop.start;
        else {
          this.finished = true;
          break;
        }
      }
      if (this.nextTime < ctx.currentTime) this.nextTime = ctx.currentTime + 0.01; // fell behind
      const frames = Math.min(CHUNK_FRAMES, this.endFrame - this.nextFrame);
      if (frames <= 0) {
        this.finished = true;
        break;
      }
      const data = source.read(this.nextFrame, frames);
      const buffer = ctx.createBuffer(Math.max(1, source.channelCount), frames, sr);
      for (let c = 0; c < buffer.numberOfChannels; c++) buffer.copyToChannel(data[Math.min(c, data.length - 1)] as Float32Array<ArrayBuffer>, c);
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      node.connect(this.master);
      node.start(this.nextTime);
      this.scheduled.push({ node, time: this.nextTime, frame: this.nextFrame, frames, data });
      this.nextTime += frames / sr;
      this.nextFrame += frames;
    }
    // forget chunks that finished playing a while ago
    const now = ctx.currentTime;
    while (this.scheduled.length > 2 && this.scheduled[0].time + this.scheduled[0].frames / sr < now - 0.5) this.scheduled.shift();
    if (this.finished && now > this.nextTime + 0.05) {
      this.stop();
      this.onEnded?.();
    }
  }

  private heardTime(): number {
    const ctx = this.ctx;
    if (!ctx) return 0;
    try {
      const ts = ctx.getOutputTimestamp();
      if (ts.contextTime !== undefined && ts.performanceTime !== undefined && ts.contextTime > 0) {
        return ts.contextTime + Math.max(0, (performance.now() - ts.performanceTime) / 1000);
      }
    } catch {
      // not supported
    }
    return ctx.currentTime - (ctx.outputLatency || 0) - (ctx.baseLatency || 0);
  }

  /** Frame currently heard (in source coordinates + offset), or null when stopped. */
  position(): number | null {
    if (!this.playing || !this.source || !this.scheduled.length) return null;
    const t = this.heardTime();
    const sr = this.source.sampleRate;
    let chunk = this.scheduled[0];
    if (t < chunk.time) return chunk.frame + this.offset;
    for (const s of this.scheduled) {
      if (t >= s.time) chunk = s;
      else break;
    }
    const within = Math.min(chunk.frames, Math.max(0, Math.round((t - chunk.time) * sr)));
    return chunk.frame + within + this.offset;
  }

  /** Peak and RMS (linear) of the ~2048 frames heard most recently, per output channel. */
  levels(): { peak: number[]; rms: number[] } {
    const count = this.source?.channelCount ?? 1;
    const peak = new Array(count).fill(0);
    const rms = new Array(count).fill(0);
    if (!this.playing || !this.source || !this.scheduled.length) return { peak, rms };
    const t = this.heardTime();
    const sr = this.source.sampleRate;
    let want = 2048;
    let n = 0;
    // walk backwards from the chunk being heard
    let idx = this.scheduled.length - 1;
    while (idx > 0 && this.scheduled[idx].time > t) idx--;
    let end = Math.min(this.scheduled[idx].frames, Math.max(0, Math.round((t - this.scheduled[idx].time) * sr)));
    while (want > 0 && idx >= 0) {
      const chunk = this.scheduled[idx];
      const from = Math.max(0, end - want);
      for (let c = 0; c < count; c++) {
        const d = chunk.data[Math.min(c, chunk.data.length - 1)];
        let p = peak[c];
        let s = 0;
        for (let i = from; i < end; i++) {
          const v = d[i] < 0 ? -d[i] : d[i];
          if (v > p) p = v;
          s += d[i] * d[i];
        }
        peak[c] = p;
        rms[c] += s;
      }
      n += end - from;
      want -= end - from;
      idx--;
      if (idx >= 0) end = this.scheduled[idx].frames;
    }
    for (let c = 0; c < count; c++) rms[c] = n ? Math.sqrt(rms[c] / n) * this.gain : 0;
    for (let c = 0; c < count; c++) peak[c] *= this.gain;
    return { peak, rms };
  }

  private stopNodes(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const s of this.scheduled) {
      try {
        s.node.stop();
        s.node.disconnect();
      } catch {
        // already stopped
      }
    }
    this.scheduled = [];
  }

  stop(): void {
    this.stopNodes();
    this.source = null;
    // release the audio device while idle
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend().catch(() => undefined);
  }

  dispose(): void {
    this.stop();
    if (this.ctx && this.ctx.state !== 'closed') void this.ctx.close().catch(() => undefined);
    this.ctx = null;
  }
}

/** A PlaySource reading straight from channel arrays (copying each chunk). */
export function channelSource(channels: Float32Array[], sampleRate: number): PlaySource {
  const count = Math.min(2, Math.max(1, channels.length));
  const length = channels[0]?.length ?? 0;
  return {
    sampleRate,
    channelCount: count,
    length,
    read(start, frames) {
      const out: Float32Array[] = [];
      for (let c = 0; c < count; c++) {
        const buf = new Float32Array(frames);
        const src = channels[c];
        const end = Math.min(length, start + frames);
        if (end > start) buf.set(src.subarray(start, end));
        out.push(buf);
      }
      return out;
    },
  };
}
