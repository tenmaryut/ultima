import type { BlendMode, CaptionStyle, Clip, Easing, Keyframe, KeyProp, LookId, MediaRef, Project, TitleStyle, TrackKind, TransitionKind } from '../types';
import { AUDIO_KEY_PROPS, EASINGS, KEY_PROPS, KEY_RANGES, RAMP_PRESETS, rampPreset, type RampPreset } from '../keyframes';
import { activeRanges, DEFAULT_DUCK, duckKeys, type Envelope } from '../ducking';
import type { MediaAnalysis } from '../analysisStore';
import {
  addCaptionCues,
  addMarker,
  addMediaToTimeline,
  addTrack,
  changeSettings,
  clipEnd,
  clipsOnTrack,
  deleteClips,
  duplicateClips,
  findFreeVideoTrack,
  getClip,
  getMedia,
  getTrack,
  insertClips,
  isLockedTrack,
  linkClips,
  makeClip,
  moveClips,
  removeMarker,
  removeTrack,
  rippleDeleteRanges,
  setClipSpeed,
  splitAt,
  timelineDuration,
  tracksOfKind,
  trimClip,
  unlinkClips,
  updateClip,
  updateMarker,
  updateTrack,
  clearRange,
  freezeFrameAt,
  setSpeedRamp,
  findTopVideoTrack,
} from '../model';
import {
  AUDIO_PRESETS,
  BLEND_IDS,
  DEFAULT_AUDIO_FX,
  DEFAULT_GRADE,
  DEFAULT_MASK,
  DEFAULT_STILL_DURATION,
  EFFECT_PROPS,
  FPS_OPTIONS,
  MAX_SPEED,
  MAX_VOLUME_DB,
  MIN_SPEED,
  MIN_VOLUME_DB,
  TITLE_PRESETS,
  TRANSITION_KINDS,
  titlePreset,
} from '../presets';
import { LOOKS } from '../grade';
import { letterboxBars } from '../fx';
import { parseAudioFx, parseGrade, parseMask } from '../project';
import { EPS, clampNum, frameDur } from '../time';
import { Skip, findTrack, resolveClips, trackOrCreate } from './targets';
import { finite, isObj, plainText, safeColor, sec, type Obj } from './util';

/* Validates and applies the Video Editor AI's actions, reporting what happened to each one. */

/** Things the editor does besides changing the document. */
export type EditorEffect =
  | { kind: 'seek'; time: number }
  | { kind: 'select'; ids: string[] }
  | { kind: 'export'; exportKind: 'social' | 'mp4' | 'webm' | 'gif' | 'wav' | 'png' };

export interface ActionResult {
  index: number;
  type: string;
  ok: boolean;
  /** What happened, or why it was skipped (sent back to the AI). */
  detail: string;
}

export interface AIApplyResult {
  project: Project;
  applied: number;
  /** Reasons for skipped actions. */
  notes: string[];
  results: ActionResult[];
  effects: EditorEffect[];
}

export interface ExecContext {
  playhead: number;
  selection?: string[];
  /** Font families that can be used in titles. */
  fonts?: string[];
  /** Content analysis of media (for ducking). */
  analysis?: (mediaId: string) => MediaAnalysis | 'pending' | null;
}

/** setClip props that belong to the sound (on a video clip they go to its linked audio). */
const AUDIO_PROP_KEYS = ['volume', 'muted', 'audioFx', 'audioPreset', 'highPass', 'lowPass', 'eqLow', 'eqMid', 'eqHigh', 'reverb', 'reverbSize'];
const FX_KEYS = ['highPass', 'lowPass', 'eqLow', 'eqMid', 'eqHigh', 'reverb', 'reverbSize'] as const;

interface State {
  p: Project;
  ctx: ExecContext;
  effects: EditorEffect[];
}

type Handler = (s: State, a: Obj) => string;

const VISUAL_KINDS = ['video', 'image', 'title'] as const;

const POSITIONS: Record<string, { x: number; y: number; align: TitleStyle['align'] }> = {
  center: { x: 0.5, y: 0.5, align: 'center' },
  top: { x: 0.5, y: 0.15, align: 'center' },
  bottom: { x: 0.5, y: 0.85, align: 'center' },
  'lower-left': { x: 0.07, y: 0.8, align: 'left' },
  'lower-third': { x: 0.07, y: 0.8, align: 'left' },
  'upper-left': { x: 0.07, y: 0.15, align: 'left' },
  'upper-right': { x: 0.93, y: 0.15, align: 'right' },
  'lower-right': { x: 0.93, y: 0.85, align: 'right' },
};

const trackName = (p: Project, id: string) => getTrack(p, id)?.name ?? '?';

/** Media by id, or by file name (exact, then partial). */
export function findMedia(p: Project, ref: unknown): MediaRef | undefined {
  if (typeof ref !== 'string' || !ref.trim()) return undefined;
  const key = ref.trim().toLowerCase();
  return getMedia(p, ref) ?? p.media.find((m) => m.name.toLowerCase() === key) ?? p.media.find((m) => m.name.toLowerCase().includes(key));
}

/** Whole-timeline length requests: "full", "all" or "end". */
const isFull = (v: unknown) => v === 'full' || v === 'all' || v === 'end';

function fontNote(font: string, fonts: string[] | undefined): string {
  if (!fonts?.length) return '';
  const known = new Set(fonts.map((f) => f.toLowerCase()));
  return known.has(font.toLowerCase()) ? '' : ` (font "${font}" is not installed, Inter is used instead)`;
}

/** Title style from a preset or from `base`, with the AI's overrides. */
function buildTitle(p: Project, styleArg: unknown, position: unknown, text: string | undefined, base?: TitleStyle): TitleStyle {
  const { width, height } = p.settings;
  const presetName = typeof styleArg === 'string' ? styleArg : isObj(styleArg) && typeof styleArg.preset === 'string' ? styleArg.preset : null;
  const preset = presetName && TITLE_PRESETS.some((x) => x.id === presetName) ? presetName : null;
  const t: TitleStyle = preset || !base ? { ...titlePreset(preset ?? 'basic', width, height) } : { ...base };
  if (base && preset) {
    // a new preset on an existing title keeps its words and place unless asked otherwise
    t.text = base.text;
    t.subtitle = base.subtitle || t.subtitle;
  }
  if (text !== undefined) t.text = text;
  const o = isObj(styleArg) ? styleArg : {};
  if (typeof o.font === 'string') t.font = plainText(o.font, 80).replace(/["';{}<>\\]/g, '') || t.font;
  if (finite(o.size)) t.size = clampNum(o.size, 8, height);
  if (finite(o.weight)) t.weight = Math.round(clampNum(o.weight, 100, 900) / 100) * 100;
  t.color = safeColor(o.color) ?? t.color;
  if (typeof o.box === 'boolean') t.box = o.box;
  t.boxColor = safeColor(o.boxColor) ?? t.boxColor;
  t.outlineColor = safeColor(o.outlineColor) ?? t.outlineColor;
  if (finite(o.outlineWidth)) t.outlineWidth = clampNum(o.outlineWidth, 0, 40);
  if (typeof o.italic === 'boolean') t.italic = o.italic;
  if (typeof o.shadow === 'boolean') t.shadow = o.shadow;
  if (['none', 'fade', 'slideUp', 'pop', 'typewriter'].includes(o.animation as string)) t.animation = o.animation as TitleStyle['animation'];
  if (finite(o.animDuration)) t.animDuration = clampNum(o.animDuration, 0.05, 10);
  if (o.align === 'left' || o.align === 'center' || o.align === 'right') t.align = o.align;
  if (typeof o.subtitle === 'string') t.subtitle = plainText(o.subtitle, 200);
  if (typeof position === 'string' && POSITIONS[position]) Object.assign(t, POSITIONS[position]);
  else if (isObj(position) && finite(position.x) && finite(position.y)) {
    t.x = clampNum(position.x, 0, 1);
    t.y = clampNum(position.y, 0, 1);
  }
  return t;
}

const letters = (v: string) => v.toLowerCase().replace(/[^a-z]/g, '');

/** A look id from an id or a name ("teal & orange"). */
function lookFrom(v: unknown): LookId | undefined {
  if (typeof v !== 'string') return undefined;
  const k = letters(v);
  return LOOKS.find((l) => letters(l.id) === k || letters(l.label) === k)?.id;
}

const BLEND_ALIASES: Record<string, BlendMode> = { lighter: 'add', additive: 'add', lineardodge: 'add', none: 'normal' };

function blendFrom(v: unknown): BlendMode | undefined {
  if (typeof v !== 'string') return undefined;
  const k = letters(v);
  return BLEND_IDS.find((b) => letters(b) === k) ?? BLEND_ALIASES[k];
}

/** Bar height (fraction of the frame) for an aspect ratio such as "2.39:1". */
function barsFor(ratio: string, W: number, H: number): number | null {
  const m = /^\s*(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)\s*$/.exec(ratio);
  if (!m) return null;
  return letterboxBars(Number(m[1]) / Math.max(1e-6, Number(m[2])), W, H);
}

/** Percentages are accepted for 0-1 values. */
const unit01 = (v: number, max = 1) => (v > max && v <= 100 ? v / 100 : v);

/** Applies one setClip props object to a clip (speed is handled separately). */
function patchClip(p: Project, cl: Clip, pr: Obj, fonts: string[] | undefined, changed: string[], warn: string[] = []): Clip {
  const W = p.settings.width;
  const H = p.settings.height;
  const next: Clip = { ...cl };
  const local: string[] = [];
  const mark = (k: string) => {
    if (!local.includes(k)) local.push(k);
    if (!changed.includes(k)) changed.push(k);
  };
  // a keyframed property ignores its plain value, so setting it removes its keyframes
  const keyed = (k: string) => Boolean(cl.keys?.[k as KeyProp]?.length);
  const unkeyed: string[] = [];
  if (cl.visual) {
    const v = { ...cl.visual };
    const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => {
      if (v[k] !== val || keyed(k)) {
        v[k] = val;
        mark(k);
        if (keyed(k)) unkeyed.push(k);
      }
    };
    if (finite(pr.opacity)) set('opacity', clampNum(pr.opacity > 1 ? pr.opacity / 100 : pr.opacity, 0, 1));
    if (finite(pr.scale)) set('scale', clampNum(pr.scale > 10 ? pr.scale / 100 : pr.scale, 0.05, 10));
    if (finite(pr.x)) set('x', clampNum(pr.x, -W * 4, W * 4));
    if (finite(pr.y)) set('y', clampNum(pr.y, -H * 4, H * 4));
    if (finite(pr.rotation)) set('rotation', clampNum(pr.rotation, -360, 360));
    for (const k of ['brightness', 'contrast', 'saturation', 'temperature'] as const) if (finite(pr[k])) set(k, clampNum(pr[k] as number, -100, 100));
    if (finite(pr.hue)) set('hue', clampNum(pr.hue, -180, 180));
    if (finite(pr.blur)) set('blur', clampNum(pr.blur, 0, 50));
    const crop = isObj(pr.crop) ? pr.crop : {};
    for (const [k, side] of [['cropLeft', 'left'], ['cropRight', 'right'], ['cropTop', 'top'], ['cropBottom', 'bottom']] as const) {
      const val = finite(pr[k]) ? (pr[k] as number) : finite(crop[side]) ? (crop[side] as number) : undefined;
      if (val !== undefined) set(k, clampNum(val > 1 ? val / 100 : val, 0, 0.45));
    }
    if (typeof pr.chromaKey === 'boolean') set('chromaKey', pr.chromaKey);
    else if (isObj(pr.chromaKey)) {
      set('chromaKey', true);
      const ck = pr.chromaKey;
      const col = safeColor(ck.color);
      if (col) set('chromaColor', col);
      if (finite(ck.similarity)) set('chromaSimilarity', clampNum(ck.similarity, 0, 1));
      if (finite(ck.smoothness)) set('chromaSmoothness', clampNum(ck.smoothness, 0, 1));
    }
    for (const e of EFFECT_PROPS) {
      const raw = pr[e.prop];
      const [lo, hi] = KEY_RANGES[e.prop];
      if (e.prop === 'letterbox' && typeof raw === 'string') {
        const bars = barsFor(raw, W, H);
        if (bars === null) warn.push(`letterbox "${raw}" is not a ratio like "2.39:1"`);
        else set('letterbox', bars);
      } else if (finite(raw)) set(e.prop, clampNum(hi <= 1 ? unit01(raw, hi) : raw, lo, hi));
    }
    if (finite(pr.shakeSpeed)) set('shakeSpeed', clampNum(pr.shakeSpeed, 0.5, 60));
    if (finite(pr.glowRadius)) set('glowRadius', clampNum(pr.glowRadius, 1, 200));
    if (finite(pr.motionBlurAngle)) set('motionBlurAngle', clampNum(pr.motionBlurAngle, -360, 360));
    next.visual = v;
  }
  if (cl.visual) {
    const blendRaw = pr.blendMode ?? pr.blend;
    if (blendRaw !== undefined) {
      const b = blendFrom(blendRaw);
      if (!b) warn.push(`unknown blend mode ${String(blendRaw)} (use ${BLEND_IDS.join(', ')})`);
      else if ((b === 'normal' ? undefined : b) !== cl.blend) {
        next.blend = b === 'normal' ? undefined : b;
        mark('blendMode');
      }
    }
    if (pr.mask === null || pr.mask === false || pr.mask === 'none') {
      if (cl.mask) {
        next.mask = undefined;
        mark('mask removed');
      }
    } else if (isObj(pr.mask) || typeof pr.mask === 'string') {
      const raw: Obj = typeof pr.mask === 'string' ? { shape: pr.mask } : { ...pr.mask };
      for (const k of ['x', 'y', 'w', 'h'] as const) if (finite(raw[k]) && (raw[k] as number) > 4) raw[k] = (raw[k] as number) / 100;
      if (finite(raw.feather)) raw.feather = unit01(raw.feather as number, 0.5);
      const m = parseMask({ ...(cl.mask ?? DEFAULT_MASK), ...raw });
      if (!m) warn.push('a mask needs "shape": rectangle, ellipse or linear');
      else if (JSON.stringify(m) !== JSON.stringify(cl.mask)) {
        next.mask = m;
        mark('mask');
      }
    }
    if (['look', 'lookAmount', 'lut', 'lutAmount', 'curves', 'hsl', 'grade'].some((k) => pr[k] !== undefined)) {
      const g: Obj = { ...(cl.grade ?? DEFAULT_GRADE), ...(isObj(pr.grade) ? pr.grade : {}) };
      if (pr.look !== undefined) {
        const id = pr.look === null || pr.look === 'none' ? undefined : lookFrom(pr.look);
        if (pr.look !== null && pr.look !== 'none' && !id) warn.push(`unknown look ${String(pr.look)}`);
        else g.look = id;
      }
      if (finite(pr.lookAmount)) g.lookAmount = unit01(pr.lookAmount);
      if (pr.lut !== undefined) {
        const key = typeof pr.lut === 'string' ? pr.lut.toLowerCase() : '';
        const lut = p.luts.find((l) => l.id === pr.lut) ?? p.luts.find((l) => l.name.toLowerCase() === key) ?? p.luts.find((l) => key && l.name.toLowerCase().includes(key));
        if (pr.lut !== null && pr.lut !== 'none' && !lut) warn.push(`unknown LUT ${String(pr.lut)} (import a .cube file first)`);
        else g.lut = lut?.id;
      }
      if (finite(pr.lutAmount)) g.lutAmount = unit01(pr.lutAmount);
      if (pr.curves === null) g.curves = undefined;
      else if (isObj(pr.curves)) g.curves = { ...(isObj(g.curves) ? g.curves : {}), ...pr.curves };
      if (pr.hsl === null) g.hsl = undefined;
      else if (isObj(pr.hsl)) {
        const old = isObj(g.hsl) ? (g.hsl as Obj) : {};
        const merged: Obj = { ...old };
        for (const [k, adj] of Object.entries(pr.hsl)) merged[k] = isObj(adj) ? { ...(isObj(old[k]) ? (old[k] as Obj) : {}), ...adj } : adj;
        g.hsl = merged;
      }
      const grade = parseGrade(g, new Set(p.luts.map((l) => l.id)));
      if (JSON.stringify(grade) !== JSON.stringify(cl.grade)) {
        next.grade = grade;
        mark('color grade');
      }
    }
  }
  if ((finite(pr.volume) || pr.muted === true) && cl.kind === 'audio') {
    const vol = pr.muted === true ? MIN_VOLUME_DB : clampNum(pr.volume as number, MIN_VOLUME_DB, MAX_VOLUME_DB);
    if (vol !== cl.volume || keyed('volume')) {
      next.volume = vol;
      mark('volume');
      if (keyed('volume')) unkeyed.push('volume');
    }
  }
  if (cl.kind === 'audio' && (pr.audioPreset !== undefined || pr.audioFx !== undefined || FX_KEYS.some((k) => finite(pr[k])))) {
    let fx: Obj = { ...(cl.audioFx ?? DEFAULT_AUDIO_FX) };
    if (pr.audioPreset === 'none' || pr.audioPreset === null || pr.audioFx === null || pr.audioFx === 'none') fx = { ...DEFAULT_AUDIO_FX };
    else if (pr.audioPreset !== undefined) {
      const key = typeof pr.audioPreset === 'string' ? letters(pr.audioPreset) : '';
      const preset = AUDIO_PRESETS.find((a) => letters(a.id) === key || letters(a.label).startsWith(key));
      if (!preset) warn.push(`unknown audioPreset ${String(pr.audioPreset)} (use ${AUDIO_PRESETS.map((a) => a.id).join(', ')})`);
      else fx = { ...preset.fx };
    }
    if (isObj(pr.audioFx)) fx = { ...fx, ...pr.audioFx };
    for (const k of FX_KEYS) if (finite(pr[k])) fx[k] = pr[k];
    if (finite(fx.reverb) && (fx.reverb as number) > 1) fx.reverb = (fx.reverb as number) / 100;
    const parsed = parseAudioFx(fx);
    if (JSON.stringify(parsed) !== JSON.stringify(cl.audioFx)) {
      next.audioFx = parsed;
      mark('sound effects');
    }
    // a fixed high cut replaces its keyframes
    if (finite(pr.lowPass) && keyed('lowPass')) unkeyed.push('lowPass');
  }
  if (unkeyed.length) {
    const keys = { ...cl.keys };
    for (const k of unkeyed) delete keys[k as KeyProp];
    next.keys = Object.keys(keys).length ? keys : undefined;
    mark(`removed the ${unkeyed.join('/')} keyframes`);
  }
  if (typeof pr.keepPitch === 'boolean' && (cl.kind === 'audio' || cl.kind === 'video') && pr.keepPitch !== cl.keepPitch) {
    next.keepPitch = pr.keepPitch;
    mark('keepPitch');
  }
  if (typeof pr.reverse === 'boolean' && (cl.kind === 'audio' || cl.kind === 'video') && pr.reverse !== Boolean(cl.reverse)) {
    next.reverse = pr.reverse || undefined;
    mark('reverse');
  }
  const blend = typeof pr.frameBlend === 'boolean' ? pr.frameBlend : typeof pr.smoothSlowMotion === 'boolean' ? pr.smoothSlowMotion : undefined;
  if (blend !== undefined && cl.kind === 'video' && blend !== Boolean(cl.frameBlend)) {
    next.frameBlend = blend || undefined;
    mark('frameBlend');
  }
  if (finite(pr.fadeIn)) {
    next.fadeIn = clampNum(pr.fadeIn, 0, cl.duration);
    if (next.fadeIn !== cl.fadeIn) mark('fadeIn');
  }
  if (finite(pr.fadeOut)) {
    next.fadeOut = clampNum(pr.fadeOut, 0, Math.max(0, cl.duration - next.fadeIn));
    if (next.fadeOut !== cl.fadeOut) mark('fadeOut');
  }
  if (typeof pr.text === 'string') {
    const text = plainText(pr.text, 2000);
    if (cl.kind === 'title' && cl.title && text && text !== cl.title.text) {
      next.title = { ...cl.title, text };
      mark('text');
    }
    if (cl.kind === 'caption' && text && text !== cl.text) {
      next.text = text;
      mark('text');
    }
  }
  if (cl.kind === 'title' && cl.title) {
    const styleKeys = ['font', 'size', 'weight', 'color', 'box', 'boxColor', 'outlineColor', 'outlineWidth', 'italic', 'shadow', 'animation', 'animDuration', 'align', 'subtitle'];
    const flat: Obj = {};
    for (const k of styleKeys) if (pr[k] !== undefined) flat[k] = pr[k];
    const style = isObj(pr.style) ? { ...pr.style, ...flat } : typeof pr.style === 'string' ? pr.style : Object.keys(flat).length ? flat : undefined;
    if (style !== undefined || pr.position !== undefined) {
      const title = buildTitle(p, style, pr.position, undefined, next.title ?? cl.title);
      if (JSON.stringify(title) !== JSON.stringify(cl.title)) {
        next.title = title;
        mark('title style');
        const note = fontNote(title.font, fonts);
        if (note && title.font !== cl.title.font) mark(note.trim());
      }
    }
  }
  if (typeof pr.name === 'string' && plainText(pr.name, 120) && plainText(pr.name, 120) !== cl.name) {
    next.name = plainText(pr.name, 120);
    mark('name');
  }
  return local.length ? next : cl;
}

/** Converts an AI value to the unit a keyframed property uses (like setClip does). */
function keyUnit(prop: KeyProp, v: number): number {
  let x = v;
  const [lo, hi] = KEY_RANGES[prop];
  if (hi <= 1) x = unit01(x, hi);
  if (prop === 'scale' && x > 10) x /= 100;
  return clampNum(x, lo, hi);
}

/** Keyframes from the AI: "t" (seconds from the clip start) or "at" (timeline seconds), a value and an easing. */
function readKeys(c: Clip, raw: unknown, unit: (v: number) => number): Keyframe[] {
  if (!Array.isArray(raw)) throw new Skip('"keys" must be a list of {"t" or "at", "v", "ease"}');
  const keys = raw
    .slice(0, 100)
    .filter(isObj)
    .map((k) => {
      const t = finite(k.t) ? k.t : finite(k.at) ? (k.at as number) - c.start : NaN;
      const v = finite(k.v) ? k.v : finite(k.value) ? (k.value as number) : NaN;
      return { t, v, ease: (EASINGS.includes(k.ease as Easing) ? k.ease : 'easeInOut') as Easing };
    })
    .filter((k) => Number.isFinite(k.t) && Number.isFinite(k.v))
    .map((k) => ({ t: clampNum(k.t, 0, c.duration), v: unit(k.v), ease: k.ease }))
    .sort((a, b) => a.t - b.t);
  if (!keys.length) throw new Skip('no valid keyframes (each needs "t" or "at" and "v")');
  return keys;
}

/** The audio clips that carry a clip's sound (itself, or the audio linked to a video). */
function soundOf(p: Project, c: Clip): Clip[] {
  if (c.kind === 'audio') return [c];
  if (c.kind === 'video' && c.linkId) return p.clips.filter((x) => x.linkId === c.linkId && x.kind === 'audio');
  return [];
}

const handlers: Record<string, Handler> = {
  addTitle(s, a) {
    const text = plainText(a.text, 300);
    if (!text) throw new Skip('a title needs "text"');
    const end = timelineDuration(s.p);
    const start = clampNum(finite(a.start) ? a.start : s.ctx.playhead, 0, 1e6);
    const duration = isFull(a.duration) ? Math.max(0.3, (end > start + 0.3 ? end : start + 4) - start) : clampNum(finite(a.duration) ? a.duration : 4, 0.3, 3600);
    const style = buildTitle(s.p, a.style, a.position, text);
    let project = s.p;
    let trackId: string;
    if (a.track !== undefined) {
      const r = trackOrCreate(s.p, a.track, 'video');
      if (!r.track) throw new Skip(`unknown video track ${String(a.track)}`);
      if (r.track.locked) throw new Skip(`track ${r.track.name} is locked`);
      project = r.project;
      trackId = r.track.id;
    } else {
      const r = findFreeVideoTrack(s.p, start, start + duration);
      project = r.project;
      trackId = r.trackId;
    }
    const clip = makeClip('title', trackId, start, duration, { name: text.slice(0, 40), title: style });
    if (finite(a.opacity) && clip.visual) clip.visual = { ...clip.visual, opacity: clampNum(a.opacity > 1 ? a.opacity / 100 : a.opacity, 0, 1) };
    s.p = insertClips(project, [clip]);
    return `added title ${clip.id} on ${trackName(s.p, trackId)} at ${sec(start)}–${sec(start + duration)}${fontNote(style.font, s.ctx.fonts)}`;
  },

  addCaption(s, a) {
    const text = plainText(a.text, 500);
    if (!text) throw new Skip('a caption needs "text"');
    const start = finite(a.start) ? Math.max(0, a.start) : s.ctx.playhead;
    const end = finite(a.end) && a.end > start ? a.end : start + 3;
    const r = addCaptionCues(s.p, [{ start, end, text }]);
    s.p = r.project;
    return `added caption ${r.ids.join(', ')} at ${sec(start)}–${sec(end)}`;
  },

  addClip(s, a) {
    const media = findMedia(s.p, a.media ?? a.mediaId);
    if (!media) throw new Skip(`unknown media ${JSON.stringify(a.media ?? a.mediaId ?? null)} (use an id from the media bin)`);
    const fd = frameDur(s.p.settings.fps);
    const start = clampNum(finite(a.start) ? a.start : s.ctx.playhead, 0, 1e6);
    let trackId: string | undefined;
    if (a.track !== undefined) {
      const kind: TrackKind = media.kind === 'audio' ? 'audio' : 'video';
      const r = trackOrCreate(s.p, a.track, kind);
      if (!r.track) throw new Skip(`unknown ${kind} track ${String(a.track)}`);
      if (r.track.locked) throw new Skip(`track ${r.track.name} is locked`);
      s.p = r.project;
      trackId = r.track.id;
    }
    let inPoint = 0;
    let duration: number;
    if (media.kind === 'image') {
      const end = timelineDuration(s.p);
      duration = isFull(a.duration) ? Math.max(0.3, (end > start + 0.3 ? end : start + DEFAULT_STILL_DURATION) - start) : clampNum(finite(a.duration) ? a.duration : DEFAULT_STILL_DURATION, fd, 3600);
    } else {
      const len = Math.max(fd, media.duration);
      inPoint = clampNum(finite(a.sourceStart) ? a.sourceStart : 0, 0, Math.max(0, len - fd));
      const wantedOut = finite(a.sourceEnd) ? a.sourceEnd : finite(a.duration) ? inPoint + a.duration : len;
      duration = clampNum(wantedOut, inPoint + fd, len) - inPoint;
    }
    const r = addMediaToTimeline(s.p, media, { start, trackId, duration });
    s.p = r.project;
    if (inPoint) for (const id of r.ids) s.p = updateClip(s.p, id, (c) => ({ ...c, in: inPoint }));
    const first = getClip(s.p, r.ids[0]);
    return `added ${r.ids.join(' + ')} ("${media.name}"${media.kind !== 'image' ? `, source ${sec(inPoint)}–${sec(inPoint + duration)}` : ''}) on ${first ? trackName(s.p, first.trackId) : '?'} at ${sec(start)}–${sec(start + duration)}`;
  },

  split(s, a) {
    if (!finite(a.time)) throw new Skip('split needs "time"');
    const ids = a.clipId !== undefined || a.clipIds !== undefined || a.clips !== undefined ? resolveClips(s.p, a, { selection: s.ctx.selection }).ids : undefined;
    const r = splitAt(s.p, a.time, ids);
    if (!r.created.length) throw new Skip(`nothing to split at ${sec(a.time)}`);
    s.p = r.project;
    return `split at ${sec(a.time)}; the parts after the cut are ${r.created.join(', ')}`;
  },

  trim(s, a) {
    const c = getClip(s.p, String(a.clipId ?? ''));
    if (!c) throw new Skip(`unknown clip ${String(a.clipId)}`);
    if (isLockedTrack(s.p, c.trackId)) throw new Skip(`clip ${c.id} is on a locked track`);
    if (!finite(a.start) && !finite(a.end)) throw new Skip('trim needs "start" and/or "end"');
    if (finite(a.start)) s.p = trimClip(s.p, c.id, 'start', a.start);
    if (finite(a.end)) s.p = trimClip(s.p, c.id, 'end', a.end);
    const now = getClip(s.p, c.id)!;
    const limited = (finite(a.start) && Math.abs(now.start - a.start) > 0.01) || (finite(a.end) && Math.abs(clipEnd(now) - a.end) > 0.01);
    return `clip ${c.id} is now ${sec(now.start)}–${sec(clipEnd(now))}${limited ? ' (limited by the source length or a neighbouring clip)' : ''}`;
  },

  move(s, a) {
    const c = getClip(s.p, String(a.clipId ?? ''));
    if (!c) throw new Skip(`unknown clip ${String(a.clipId)}`);
    if (isLockedTrack(s.p, c.trackId)) throw new Skip(`clip ${c.id} is on a locked track`);
    const kind = getTrack(s.p, c.trackId)?.kind ?? 'video';
    let shift = 0;
    if (a.track !== undefined) {
      const r = trackOrCreate(s.p, a.track, kind);
      if (!r.track) throw new Skip(`unknown ${kind} track ${String(a.track)}`);
      s.p = r.project;
      const list = tracksOfKind(s.p, kind);
      shift = list.findIndex((t) => t.id === r.track!.id) - list.findIndex((t) => t.id === c.trackId);
    }
    const start = finite(a.start) ? Math.max(0, a.start) : c.start;
    s.p = moveClips(s.p, [c.id], start - c.start, shift, kind);
    const now = getClip(s.p, c.id)!;
    return `clip ${c.id} is now on ${trackName(s.p, now.trackId)} at ${sec(now.start)}–${sec(clipEnd(now))} (whatever was there is overwritten)`;
  },

  shift(s, a) {
    if (!finite(a.by) || Math.abs(a.by) < EPS) throw new Skip('shift needs "by" (seconds, + later / − earlier)');
    let ids: string[];
    if (a.clipId !== undefined || a.clipIds !== undefined || a.clips !== undefined) ids = resolveClips(s.p, a, { selection: s.ctx.selection }).ids;
    else {
      const from = finite(a.from) ? a.from : 0;
      ids = s.p.clips.filter((c) => c.start >= from - EPS && !isLockedTrack(s.p, c.trackId)).map((c) => c.id);
    }
    if (!ids.length) throw new Skip('no clips to shift');
    let by = a.by;
    if (by < 0) {
      // never slide onto clips that stay where they are
      const moving = new Set(ids);
      for (const c of s.p.clips.filter((x) => moving.has(x.id))) {
        const before = s.p.clips.filter((o) => !moving.has(o.id) && o.trackId === c.trackId && clipEnd(o) <= c.start + EPS);
        const room = c.start - Math.max(0, ...before.map(clipEnd));
        by = Math.max(by, -room);
      }
    }
    if (Math.abs(by) < EPS) throw new Skip('no room to move earlier');
    s.p = moveClips(s.p, ids, by);
    return `moved ${ids.length} clip(s) by ${by > 0 ? '+' : ''}${by.toFixed(2)} s${by !== a.by ? ` (limited from ${a.by} s by the clips before them)` : ''}`;
  },

  closeGaps(s, a) {
    const tracks =
      a.track === undefined || a.track === 'all'
        ? s.p.tracks.filter((t) => t.kind !== 'caption' && !t.locked)
        : [findTrack(s.p, a.track)].filter((t): t is NonNullable<typeof t> => Boolean(t && !t.locked));
    if (!tracks.length) throw new Skip(`unknown or locked track ${String(a.track)}`);
    let closed = 0;
    for (const track of tracks) {
      let cursor = 0;
      for (const c of [...clipsOnTrack(s.p, track.id)].sort((x, y) => x.start - y.start)) {
        const cur = getClip(s.p, c.id);
        if (!cur) continue;
        if (cur.start > cursor + 0.001) {
          s.p = moveClips(s.p, [cur.id], cursor - cur.start);
          closed++;
        }
        cursor = clipEnd(getClip(s.p, cur.id) ?? cur);
      }
    }
    if (!closed) throw new Skip('there are no gaps to close');
    return `closed ${closed} gap(s) on ${tracks.map((t) => t.name).join(', ')}`;
  },

  removeRange(s, a) {
    if (!finite(a.from) || !finite(a.to) || a.to <= a.from) throw new Skip('removeRange needs "from" < "to"');
    const from = Math.max(0, a.from);
    const to = a.to;
    if (a.ripple === false) {
      const tracks = a.tracks === undefined ? s.p.tracks.filter((t) => !t.locked) : (Array.isArray(a.tracks) ? a.tracks : [a.tracks]).map((t) => findTrack(s.p, t)).filter((t): t is NonNullable<typeof t> => Boolean(t && !t.locked));
      if (!tracks.length) throw new Skip('no unlocked tracks named');
      let clips = s.p.clips;
      for (const t of tracks) clips = clearRange(clips, t.id, from, to);
      s.p = { ...s.p, clips };
      return `cleared ${sec(from)}–${sec(to)} on ${tracks.map((t) => t.name).join(', ')} (a gap is left)`;
    }
    s.p = rippleDeleteRanges(s.p, [{ start: from, end: to }]);
    return `removed ${sec(from)}–${sec(to)} from all unlocked tracks and closed the gap (later clips moved ${(to - from).toFixed(2)} s earlier)`;
  },

  delete(s, a) {
    const { ids, notes } = resolveClips(s.p, a, { selection: s.ctx.selection });
    s.p = deleteClips(s.p, ids, { ripple: a.ripple === true });
    return `deleted ${ids.length} clip(s)${a.ripple === true ? ' and closed the gaps' : ''}${notes.length ? ` (${notes.join('; ')})` : ''}`;
  },

  duplicate(s, a) {
    const { ids } = resolveClips(s.p, a, { selection: s.ctx.selection });
    const r = duplicateClips(s.p, ids);
    if (!r.ids.length) throw new Skip('nothing to duplicate');
    s.p = r.project;
    if (finite(a.start)) {
      const first = Math.min(...r.ids.map((id) => getClip(s.p, id)?.start ?? 0));
      s.p = moveClips(s.p, r.ids, Math.max(0, a.start) - first);
    }
    return `copies: ${r.ids.join(', ')}`;
  },

  setClip(s, a) {
    if (!isObj(a.props)) throw new Skip('setClip needs "props"');
    const pr = a.props;
    const { ids, notes } = resolveClips(s.p, a, { selection: s.ctx.selection });
    const changed: string[] = [];
    const warn: string[] = [];
    for (const id of ids) {
      const c = getClip(s.p, id);
      if (!c) continue;
      if (finite(pr.speed) && (c.kind === 'video' || c.kind === 'audio')) {
        const before = s.p;
        s.p = setClipSpeed(s.p, c.id, clampNum(pr.speed, MIN_SPEED, MAX_SPEED));
        if (s.p !== before && !changed.includes('speed')) changed.push('speed');
      }
      s.p = updateClip(s.p, c.id, (cl) => patchClip(s.p, cl, pr, s.ctx.fonts, changed, warn));
      // reversing a video reverses its sound too
      if (typeof pr.reverse === 'boolean' && c.kind === 'video' && c.linkId) {
        for (const partner of s.p.clips.filter((x) => x.linkId === c.linkId && x.kind === 'audio')) s.p = updateClip(s.p, partner.id, (x) => ({ ...x, reverse: (pr.reverse as boolean) || undefined }));
      }
      // sound settings on a video clip apply to its linked audio
      if (c.kind === 'video' && c.linkId && AUDIO_PROP_KEYS.some((k) => pr[k] !== undefined)) {
        const audioProps = Object.fromEntries(AUDIO_PROP_KEYS.filter((k) => pr[k] !== undefined).map((k) => [k, pr[k]]));
        for (const partner of s.p.clips.filter((x) => x.linkId === c.linkId && x.kind === 'audio')) {
          s.p = updateClip(s.p, partner.id, (x) => patchClip(s.p, x, audioProps, s.ctx.fonts, changed, warn));
        }
      }
    }
    const all = [...notes, ...new Set(warn)];
    if (!changed.length) throw new Skip(`nothing changed${all.length ? ` (${all.join('; ')})` : ' (unknown or unsupported props, or the values were already set)'}`);
    const speedNote = changed.includes('speed') ? '; speed changes the clip length (length = source span ÷ speed)' : '';
    return `${ids.length} clip(s): ${changed.join(', ')}${speedNote}${all.length ? ` (${all.join('; ')})` : ''}`;
  },

  addTransition(s, a) {
    const { ids, notes } = resolveClips(s.p, a, { kinds: [...VISUAL_KINDS], selection: s.ctx.selection });
    const kind = a.kind;
    if (kind !== 'none' && !TRANSITION_KINDS.includes(kind as TransitionKind)) throw new Skip(`unknown transition ${String(kind)} (use ${TRANSITION_KINDS.join(', ')} or none)`);
    const out = a.position === 'out' || a.out === true || a.side === 'out';
    // several clips: transitions in go between clips, so clips with nothing right before them are left alone
    const many = ids.length > 1 && !out;
    let done = 0;
    let lone = 0;
    for (const id of ids) {
      const c = getClip(s.p, id)!;
      if (many && kind !== 'none') {
        const hasBefore = s.p.clips.some((o) => o.id !== c.id && o.trackId === c.trackId && Math.abs(clipEnd(o) - c.start) < 0.02);
        if (!hasBefore) {
          lone++;
          continue;
        }
      }
      const value = kind === 'none' ? undefined : { kind: kind as TransitionKind, duration: clampNum(finite(a.duration) ? a.duration : 1, 0.1, Math.min(5, c.duration)) };
      s.p = updateClip(s.p, c.id, (x) => (out ? { ...x, transitionOut: value } : { ...x, transition: value }));
      done++;
    }
    if (!done) throw new Skip('no clip has another clip right before it on its track (use "position":"out" for an animation at the end of a clip)');
    const extra = [...notes, lone ? `${lone} clip(s) without a clip right before them were left alone` : ''].filter(Boolean);
    const what = kind === 'none' ? `removed ${out ? 'out-animations' : 'transitions'} from` : out ? `${String(kind)} out of` : `${String(kind)} into`;
    return `${what} ${done} clip(s)${extra.length ? ` (${extra.join('; ')})` : ''}`;
  },

  addAdjustment(s, a) {
    const end = timelineDuration(s.p);
    const start = clampNum(finite(a.start) ? a.start : s.ctx.playhead, 0, 1e6);
    const duration = isFull(a.duration) || a.duration === undefined ? Math.max(0.3, (end > start + 0.3 ? end : start + 4) - start) : clampNum(finite(a.duration) ? a.duration : 4, 0.1, 36000);
    let project = s.p;
    let trackId: string;
    if (a.track !== undefined) {
      const r = trackOrCreate(s.p, a.track, 'video');
      if (!r.track) throw new Skip(`unknown video track ${String(a.track)}`);
      if (r.track.locked) throw new Skip(`track ${r.track.name} is locked`);
      project = r.project;
      trackId = r.track.id;
    } else {
      // above every picture it should change
      const r = findTopVideoTrack(s.p, start, start + duration);
      project = r.project;
      trackId = r.trackId;
    }
    let clip = makeClip('adjustment', trackId, start, duration, { name: plainText(a.name, 80) || 'Adjustment' });
    const changed: string[] = [];
    const warn: string[] = [];
    if (isObj(a.props)) clip = patchClip(project, clip, a.props, s.ctx.fonts, changed, warn);
    s.p = insertClips(project, [clip]);
    const below = tracksOfKind(s.p, 'video').findIndex((t) => t.id === trackId);
    return `added adjustment layer ${clip.id} on ${trackName(s.p, trackId)} at ${sec(start)}–${sec(start + duration)}; it changes tracks V1–V${below}${changed.length ? ` (${changed.join(', ')})` : ''}${warn.length ? ` (${warn.join('; ')})` : ''}`;
  },

  addMarker(s, a) {
    if (!finite(a.time)) throw new Skip('a marker needs "time"');
    const r = addMarker(s.p, Math.max(0, a.time), plainText(a.label, 100));
    s.p = r.project;
    const end = timelineDuration(s.p);
    return `marker ${r.id} at ${sec(Math.max(0, a.time))}${a.time > end + EPS ? ` (after the end of the timeline, ${sec(end)})` : ''}`;
  },

  updateMarker(s, a) {
    const m = s.p.markers.find((x) => x.id === a.id) ?? (finite(a.at) ? s.p.markers.find((x) => Math.abs(x.time - (a.at as number)) < 0.05) : undefined);
    if (!m) throw new Skip(`unknown marker ${String(a.id ?? a.at)}`);
    const patch: { time?: number; label?: string } = {};
    if (finite(a.time)) patch.time = Math.max(0, a.time);
    if (typeof a.label === 'string') patch.label = plainText(a.label, 100);
    if (!Object.keys(patch).length) throw new Skip('updateMarker needs "time" and/or "label"');
    s.p = updateMarker(s.p, m.id, patch);
    return `marker ${m.id} updated`;
  },

  deleteMarker(s, a) {
    const end = timelineDuration(s.p);
    const pick =
      a.id === 'all' || a.which === 'all'
        ? s.p.markers
        : a.which === 'afterEnd' || a.id === 'afterEnd'
          ? s.p.markers.filter((m) => m.time > end + EPS)
          : s.p.markers.filter((m) => m.id === a.id || (Array.isArray(a.ids) && a.ids.includes(m.id)) || (finite(a.at) && Math.abs(m.time - (a.at as number)) < 0.05));
    if (!pick.length) throw new Skip('no matching markers');
    for (const m of pick) s.p = removeMarker(s.p, m.id);
    return `deleted ${pick.length} marker(s)`;
  },

  addTrack(s, a) {
    const kind = a.kind === 'audio' || a.kind === 'caption' ? a.kind : a.kind === 'video' || a.kind === undefined ? 'video' : null;
    if (!kind) throw new Skip('kind must be video, audio or caption');
    const r = addTrack(s.p, kind);
    s.p = r.project;
    if (typeof a.name === 'string' && plainText(a.name, 40)) s.p = updateTrack(s.p, r.track.id, { name: plainText(a.name, 40) });
    return `added ${kind} track ${getTrack(s.p, r.track.id)!.name}`;
  },

  setTrack(s, a) {
    const track = findTrack(s.p, a.track);
    if (!track) throw new Skip(`unknown track ${String(a.track)}`);
    const patch: Partial<{ name: string; muted: boolean; hidden: boolean; locked: boolean; solo: boolean }> = {};
    for (const k of ['muted', 'hidden', 'locked', 'solo'] as const) if (typeof a[k] === 'boolean') patch[k] = a[k] as boolean;
    if (typeof a.name === 'string' && plainText(a.name, 40)) patch.name = plainText(a.name, 40);
    if (!Object.keys(patch).length) throw new Skip('setTrack needs name, muted, hidden, locked or solo');
    s.p = updateTrack(s.p, track.id, patch);
    return `track ${track.name}: ${Object.entries(patch).map(([k, v]) => `${k} ${String(v)}`).join(', ')}`;
  },

  deleteTrack(s, a) {
    const track = findTrack(s.p, a.track);
    if (!track) throw new Skip(`unknown track ${String(a.track)}`);
    if (track.locked) throw new Skip(`track ${track.name} is locked`);
    const count = s.p.clips.filter((c) => c.trackId === track.id).length;
    if (count && a.withClips !== true) throw new Skip(`track ${track.name} has ${count} clip(s); add "withClips": true to delete them too`);
    if (tracksOfKind(s.p, track.kind).length <= 1 && track.kind !== 'caption') throw new Skip(`the last ${track.kind} track can't be deleted`);
    s.p = removeTrack(s.p, track.id);
    return `deleted track ${track.name}${count ? ` and its ${count} clip(s)` : ''}`;
  },

  link(s, a) {
    const { ids } = resolveClips(s.p, a, { selection: s.ctx.selection });
    if (ids.length < 2) throw new Skip('link needs at least two clips');
    s.p = linkClips(s.p, ids);
    return `linked ${ids.join(', ')}`;
  },

  unlink(s, a) {
    const { ids } = resolveClips(s.p, a, { selection: s.ctx.selection });
    const before = s.p;
    s.p = unlinkClips(s.p, ids);
    if (s.p === before) throw new Skip('those clips are not linked');
    return `unlinked — video and audio now move separately`;
  },

  setWorkArea(s, a) {
    if (a.clear === true || a.start === null) {
      s.p = { ...s.p, workArea: null };
      return 'work area cleared';
    }
    if (!finite(a.start) || !finite(a.end) || a.end <= a.start) throw new Skip('setWorkArea needs "start" < "end" (or "clear": true)');
    s.p = { ...s.p, workArea: { start: Math.max(0, a.start), end: a.end } };
    return `work area ${sec(Math.max(0, a.start))}–${sec(a.end)} (export and loop use it)`;
  },

  setCaptionStyle(s, a) {
    const cs: CaptionStyle = { ...s.p.captionStyle };
    if (typeof a.font === 'string') cs.font = plainText(a.font, 80).replace(/["';{}<>\\]/g, '') || cs.font;
    if (finite(a.size)) cs.size = clampNum(a.size, 8, s.p.settings.height / 4);
    if (finite(a.weight)) cs.weight = Math.round(clampNum(a.weight, 100, 900) / 100) * 100;
    cs.color = safeColor(a.color) ?? cs.color;
    cs.outlineColor = safeColor(a.outlineColor) ?? cs.outlineColor;
    if (finite(a.outlineWidth)) cs.outlineWidth = clampNum(a.outlineWidth, 0, 20);
    if (typeof a.box === 'boolean') cs.box = a.box;
    cs.boxColor = safeColor(a.boxColor) ?? cs.boxColor;
    if (a.position === 'top' || a.position === 'bottom') cs.position = a.position;
    if (finite(a.margin)) cs.margin = clampNum(a.margin, 0, 0.45);
    if (finite(a.maxWidth)) cs.maxWidth = clampNum(a.maxWidth, 0.2, 1);
    if (JSON.stringify(cs) === JSON.stringify(s.p.captionStyle)) throw new Skip('nothing changed');
    s.p = { ...s.p, captionStyle: cs };
    return `caption style updated${fontNote(cs.font, s.ctx.fonts)}`;
  },

  setProject(s, a) {
    const st = { ...s.p.settings };
    const even = (v: number) => Math.max(16, Math.min(7680, Math.round(v / 2) * 2));
    if (finite(a.width)) st.width = even(a.width);
    if (finite(a.height)) st.height = even(a.height);
    if (finite(a.fps)) st.fps = FPS_OPTIONS.reduce((best, f) => (Math.abs(f - (a.fps as number)) < Math.abs(best - (a.fps as number)) ? f : best), 30);
    st.background = safeColor(a.background) ?? st.background;
    s.p = changeSettings(s.p, st);
    return `project ${st.width}×${st.height}, ${st.fps} fps, background ${st.background}`;
  },

  keyframes(s, a) {
    const prop = a.prop as KeyProp;
    if (!KEY_PROPS.includes(prop)) throw new Skip(`"prop" must be one of ${KEY_PROPS.join(', ')}`);
    const { ids, notes } = resolveClips(s.p, a, { selection: s.ctx.selection });
    let done = 0;
    for (const id of ids) {
      const c = getClip(s.p, id)!;
      const targets = AUDIO_KEY_PROPS.includes(prop) ? soundOf(s.p, c) : c.visual ? [c] : [];
      for (const target of targets) {
        const keys = readKeys(target, a.keys, (v) => keyUnit(prop, v));
        s.p = updateClip(s.p, target.id, (x) => {
          const merged = a.replace === false ? [...(x.keys?.[prop] ?? []).filter((k) => !keys.some((n) => Math.abs(n.t - k.t) < 1 / 120)), ...keys].sort((p1, p2) => p1.t - p2.t) : keys;
          return { ...x, keys: { ...x.keys, [prop]: merged } };
        });
        done++;
      }
    }
    if (!done) throw new Skip(AUDIO_KEY_PROPS.includes(prop) ? 'none of those clips has sound' : 'none of those clips has a picture');
    return `${prop} keyframes on ${done} clip(s)${notes.length ? ` (${notes.join('; ')})` : ''}`;
  },

  clearKeyframes(s, a) {
    const { ids } = resolveClips(s.p, a, { selection: s.ctx.selection });
    const prop = typeof a.prop === 'string' && a.prop !== 'all' ? (a.prop as KeyProp) : null;
    if (prop && !KEY_PROPS.includes(prop) && a.prop !== 'speed') throw new Skip(`unknown prop ${String(a.prop)}`);
    let done = 0;
    for (const id of ids) {
      const c = getClip(s.p, id)!;
      for (const target of [c, ...soundOf(s.p, c).filter((x) => x.id !== c.id)]) {
        s.p = updateClip(s.p, target.id, (x) => {
          if (a.prop === 'speed') return x.speedKeys ? { ...x, speedKeys: undefined } : x;
          if (!x.keys) return x;
          if (!prop) return { ...x, keys: undefined };
          if (!x.keys[prop]) return x;
          const keys = { ...x.keys };
          delete keys[prop];
          return { ...x, keys: Object.keys(keys).length ? keys : undefined };
        });
        done++;
      }
    }
    return `cleared ${a.prop === 'speed' ? 'the speed ramp' : prop ? `${prop} keyframes` : 'all keyframes'} on ${done} clip(s)`;
  },

  speedRamp(s, a) {
    const { ids } = resolveClips(s.p, a, { kinds: ['video', 'audio'], selection: s.ctx.selection });
    const keep = a.keep === 'content' ? 'content' : 'length';
    const notes: string[] = [];
    const done = new Set<string>();
    for (const id of ids) {
      const c = getClip(s.p, id);
      if (!c || done.has(c.id)) continue;
      if (c.freeze) {
        notes.push(`${c.id} is a freeze frame`);
        continue;
      }
      let keys: Keyframe[];
      if (typeof a.preset === 'string') {
        if (!RAMP_PRESETS.some((r) => r.id === a.preset)) throw new Skip(`unknown preset ${a.preset} (use ${RAMP_PRESETS.map((r) => r.id).join(', ')})`);
        keys = rampPreset(a.preset as RampPreset, c.duration, finite(a.fast) ? clampNum(a.fast, MIN_SPEED, MAX_SPEED) : 2, finite(a.slow) ? clampNum(a.slow, MIN_SPEED, MAX_SPEED) : 0.35);
      } else keys = readKeys(c, a.keys, (v) => clampNum(v, MIN_SPEED, MAX_SPEED));
      const r = setSpeedRamp(s.p, c.id, keys, keep);
      if (!r) {
        notes.push(`${c.id}: no source left for this ramp`);
        continue;
      }
      // the linked sound got the same ramp
      for (const x of r.project.clips) if (x.linkId && x.linkId === c.linkId) done.add(x.id);
      done.add(c.id);
      s.p = r.project;
      if (keep === 'content') notes.push(`${c.id} is now ${r.duration.toFixed(2)} s long${r.moved ? `; ${r.moved} later clip(s) moved ${sec(r.duration - c.duration)}` : ''}`);
      else if (r.duration < c.duration - 1e-3) notes.push(`${c.id} got shorter (${r.duration.toFixed(2)} s) because the source ends`);
    }
    if (!done.size) throw new Skip(notes.join('; ') || 'no clips to ramp');
    return `speed ramp on ${done.size} clip(s)${notes.length ? ` (${notes.join('; ')})` : ''}`;
  },

  freezeFrame(s, a) {
    const c = getClip(s.p, String(a.clipId ?? ''));
    if (!c || c.kind !== 'video') throw new Skip('freezeFrame needs the "clipId" of a video clip');
    const time = finite(a.time) ? a.time : finite(a.at) ? (a.at as number) : NaN;
    if (!Number.isFinite(time)) throw new Skip('freezeFrame needs "time" (timeline seconds inside the clip)');
    const duration = clampNum(finite(a.duration) ? a.duration : 1, 0.1, 30);
    const r = freezeFrameAt(s.p, c.id, time, duration);
    if (!r.id) throw new Skip(`${sec(time)} is not inside ${c.id}, or its track is locked`);
    s.p = r.project;
    return `freeze frame ${r.id} at ${sec(time)} for ${duration.toFixed(2)} s; everything after moved ${duration.toFixed(2)} s later`;
  },

  duck(s, a) {
    // what goes down (music), and what it makes room for (voice, game sound)
    const targetIds = resolveClips(s.p, a, { kinds: ['audio', 'video'], selection: s.ctx.selection }).ids;
    const targets = [...new Set(targetIds.flatMap((id) => soundOf(s.p, getClip(s.p, id)!)))].filter((c) => !isLockedTrack(s.p, c.trackId));
    if (!targets.length) throw new Skip('none of those clips has sound');
    const targetSet = new Set(targets.map((c) => c.id));
    let triggers: Clip[];
    if (a.trigger !== undefined) {
      const r = resolveClips(s.p, { clips: a.trigger }, { kinds: ['audio', 'video'], optional: true });
      triggers = [...new Set(r.ids.flatMap((id) => soundOf(s.p, getClip(s.p, id)!)))];
    } else triggers = s.p.clips.filter((c) => c.kind === 'audio' && !targetSet.has(c.id));
    const muted = new Set(s.p.tracks.filter((t) => t.muted).map((t) => t.id));
    triggers = triggers.filter((c) => !targetSet.has(c.id) && !muted.has(c.trackId) && c.mediaId);
    if (!triggers.length) throw new Skip('no other sound to duck under (give "trigger": the voice or game sound clips or track)');
    if (!s.ctx.analysis) throw new Skip('the sound analysis is not available');
    const withEnv: { clip: Clip; env: Envelope }[] = [];
    const pending: string[] = [];
    for (const c of triggers) {
      const res = s.ctx.analysis(c.mediaId!);
      if (res === 'pending') pending.push(c.id);
      else if (res?.audio?.envelope.db.length) withEnv.push({ clip: c, env: res.audio.envelope });
    }
    if (!withEnv.length) throw new Skip(pending.length ? 'the sound is still being analysed — try again in a moment' : 'the trigger clips have no analysed sound');
    const ranges = activeRanges(withEnv, { threshold: finite(a.threshold) ? clampNum(a.threshold, -80, 0) : undefined });
    const opts = {
      amount: finite(a.amount) ? clampNum(-Math.abs(a.amount), -40, -1) : DEFAULT_DUCK.amount,
      attack: finite(a.attack) ? clampNum(a.attack, 0.01, 2) : DEFAULT_DUCK.attack,
      release: finite(a.release) ? clampNum(a.release, 0.02, 4) : DEFAULT_DUCK.release,
    };
    let ducked = 0;
    let dips = 0;
    for (const c of targets) {
      const keys = duckKeys(c, ranges, opts);
      s.p = updateClip(s.p, c.id, (x) => {
        const rest = { ...x.keys };
        delete rest.volume;
        return { ...x, keys: keys ? { ...rest, volume: keys } : Object.keys(rest).length ? rest : undefined };
      });
      if (keys) {
        ducked++;
        dips += keys.filter((k) => k.v < c.volume - 0.01 && k.ease === 'linear').length;
      }
    }
    if (!ducked) throw new Skip('the trigger sound is never loud while those clips play');
    const total = ranges.reduce((n, r) => n + r.end - r.start, 0);
    return `lowered ${ducked} clip(s) by ${Math.abs(opts.amount)} dB while the other sound is loud (${dips} dip(s), ${total.toFixed(1)} s in all; volume keyframes)${pending.length ? `; ${pending.length} trigger clip(s) were still being analysed` : ''}`;
  },

  seek(s, a) {
    if (!finite(a.time)) throw new Skip('seek needs "time"');
    const time = clampNum(a.time, 0, Math.max(0, timelineDuration(s.p)));
    s.effects.push({ kind: 'seek', time });
    return `playhead moved to ${sec(time)}`;
  },

  select(s, a) {
    const { ids } = resolveClips(s.p, a, { selection: s.ctx.selection, optional: true });
    s.effects.push({ kind: 'select', ids });
    return ids.length ? `selected ${ids.join(', ')}` : 'selection cleared';
  },

  export(s, a) {
    const kinds = ['social', 'mp4', 'webm', 'gif', 'wav', 'png'] as const;
    const exportKind = kinds.includes(a.format as (typeof kinds)[number]) ? (a.format as (typeof kinds)[number]) : 'mp4';
    s.effects.push({ kind: 'export', exportKind });
    return `opened the ${exportKind} export dialog — the user picks where to save and starts it`;
  },
};

/** Action types the executor understands (undo/redo and look are handled by the editor and the panel). */
export const VIDEO_ACTION_TYPES = Object.keys(handlers);

/** Validates and applies AI actions. Never throws for bad input — bad actions are skipped with a reason. */
export function applyAIActions(project: Project, actions: unknown[], ctx: ExecContext): AIApplyResult {
  const s: State = { p: project, ctx, effects: [] };
  const results: ActionResult[] = [];
  const notes: string[] = [];
  let applied = 0;
  actions.slice(0, 300).forEach((raw, index) => {
    const type = isObj(raw) && typeof raw.type === 'string' ? raw.type : '?';
    const fail = (detail: string) => {
      results.push({ index, type, ok: false, detail });
      notes.push(type === '?' ? detail : `${type}: ${detail}`);
    };
    if (!isObj(raw) || type === '?') return fail('not an action object');
    if (type === 'undo' || type === 'redo') return fail(`${type} only works as the first action(s) of a reply`);
    if (type === 'look') return fail('look is answered with pictures before any edit; send it on its own');
    const handler = handlers[type];
    if (!handler) return fail(`unsupported action "${type}"`);
    const before = s.p;
    const effectsBefore = s.effects.length;
    try {
      const detail = handler(s, raw);
      if (s.p === before && s.effects.length === effectsBefore) return fail(`nothing changed (${detail})`);
      results.push({ index, type, ok: true, detail });
      applied++;
    } catch (error) {
      s.p = before;
      s.effects.length = effectsBefore;
      fail(error instanceof Skip ? error.message : `failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  return { project: s.p, applied, notes, results, effects: s.effects };
}

/** One line per action for the AI: what was done and what was skipped. */
export function formatResults(results: ActionResult[]): string {
  if (!results.length) return 'No actions.';
  return results.map((r) => `${r.index + 1}. ${r.type}: ${r.ok ? 'done' : 'SKIPPED'} — ${r.detail}`).join('\n');
}
