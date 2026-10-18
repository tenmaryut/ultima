import type { AudioFx, BlendMode, CaptionStyle, Clip, ClipKind, ClipMask, ColorGrade, CurveChannel, Easing, FontAsset, HueRange, Keyframe, KeyProp, LookId, ClipMatte, LutAsset, MediaRef, MotionTrack, Project, TitleStyle, Track, Transition, VisualProps } from './types';
import { AUDIO_KEY_PROPS, EASINGS, KEY_PROPS, KEY_RANGES } from './keyframes';
import { BLEND_IDS, DEFAULT_AUDIO_FX, DEFAULT_SETTINGS, DEFAULT_VISUAL, MAX_SPEED, MAX_VOLUME_DB, MIN_SPEED, MIN_VOLUME_DB, TRANSITION_KINDS, defaultCaptionStyle, defaultTitle } from './presets';
import { CURVE_CHANNELS, HUE_RANGE_IDS, LOOK_IDS, cleanCurve, isIdentityCurve } from './grade';
import { createProject, normalizeLinks, trackKindForClip } from './model';
import { clampNum } from './time';

/* .ultima project files: serialization and strict validation (pure). */

export const PROJECT_EXTENSION = 'ultima';

export function serializeProject(p: Project): string {
  return JSON.stringify(
    {
      app: 'ultima',
      module: 'video',
      version: 1,
      name: p.name,
      savedAt: new Date().toISOString(),
      settings: p.settings,
      media: p.media,
      tracks: p.tracks,
      clips: p.clips,
      markers: p.markers,
      workArea: p.workArea,
      captionStyle: p.captionStyle,
      luts: p.luts,
      fonts: p.fonts,
    },
    null,
    1,
  );
}

/** Cheap check used before parsing: is this an Ultima video project? */
export function looksLikeVideoProject(text: string): boolean {
  const head = text.slice(0, 4096);
  return /"app"\s*:\s*"ultima"/.test(head) && /"module"\s*:\s*"video"/.test(head);
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, fallback = '', max = 10000) => (typeof v === 'string' ? v.slice(0, max) : fallback);
const bool = (v: unknown, fallback = false) => (typeof v === 'boolean' ? v : fallback);
function n(v: unknown, fallback: number, min = -Infinity, max = Infinity): number {
  return typeof v === 'number' && Number.isFinite(v) ? clampNum(v, min, max) : fallback;
}
const color = (v: unknown, fallback: string) => (typeof v === 'string' && v.length < 64 && /^[#a-z0-9(),.\s%-]+$/i.test(v) ? v : fallback);

/** A validated keyframe list (sorted, values clamped to `range`). */
function parseKeyList(v: unknown, range: [number, number], maxT: number): Keyframe[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const list = v
    .slice(0, 500)
    .filter(isObj)
    .filter((k) => typeof k.t === 'number' && Number.isFinite(k.t) && typeof k.v === 'number' && Number.isFinite(k.v))
    .map((k) => ({ t: clampNum(k.t as number, 0, maxT), v: clampNum(k.v as number, range[0], range[1]), ease: (EASINGS.includes(k.ease as Easing) ? k.ease : 'linear') as Easing }))
    .sort((a, b) => a.t - b.t);
  return list.length ? list : undefined;
}

/** A cut-out subject (at most 1800 masks of base64 PNG). */
export function parseMatte(v: unknown): ClipMatte | undefined {
  if (!isObj(v) || !Array.isArray(v.frames) || !v.frames.length) return undefined;
  const frames = v.frames.slice(0, 1800).filter((f): f is string => typeof f === 'string' && f.length < 4_000_000 && /^[A-Za-z0-9+/=]+$/.test(f));
  if (frames.length !== Math.min(1800, v.frames.length)) return undefined;
  return {
    start: n(v.start, 0, 0, 1e7),
    fps: n(v.fps, 15, 1, 120),
    w: Math.round(n(v.w, 0, 1, 4096)),
    h: Math.round(n(v.h, 0, 1, 4096)),
    frames,
    invert: v.invert === true ? true : undefined,
    model: v.model === 'people' ? 'people' : 'anything',
  };
}

/** Motion tracks of a video clip (at most 20, each at most 20 000 points). */
export function parseMotionTracks(v: unknown): MotionTrack[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: MotionTrack[] = [];
  for (const t of v.slice(0, 20)) {
    if (!isObj(t) || typeof t.id !== 'string' || !Array.isArray(t.points) || out.some((x) => x.id === t.id)) continue;
    const points: MotionTrack['points'] = [];
    for (const q of t.points.slice(0, 20000)) {
      if (!isObj(q)) continue;
      const time = n(q.t, NaN, 0, 1e7);
      const x = n(q.x, NaN, -1, 2);
      const y = n(q.y, NaN, -1, 2);
      if (!Number.isFinite(time) || !Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (points.length && time <= points[points.length - 1].t) continue;
      points.push({ t: time, x, y, s: n(q.s, 1, 0, 1) });
    }
    if (points.length < 2) continue;
    out.push({ id: t.id.slice(0, 40), name: str(t.name, 'Track', 80), points, w: n(t.w, 0.05, 0.001, 1), h: n(t.h, 0.05, 0.001, 1) });
  }
  return out.length ? out : undefined;
}

function parseKeys(v: unknown, maxT: number, visual: boolean, audio: boolean): Clip['keys'] {
  if (!isObj(v)) return undefined;
  const out: Partial<Record<KeyProp, Keyframe[]>> = {};
  for (const k of KEY_PROPS) {
    if (AUDIO_KEY_PROPS.includes(k) ? !audio : !visual) continue;
    const list = parseKeyList(v[k], KEY_RANGES[k], maxT);
    if (list) out[k] = list;
  }
  return Object.keys(out).length ? out : undefined;
}

function parseVisual(v: unknown): VisualProps {
  const o = isObj(v) ? v : {};
  const d = DEFAULT_VISUAL;
  return {
    x: n(o.x, d.x, -100000, 100000),
    y: n(o.y, d.y, -100000, 100000),
    scale: n(o.scale, d.scale, 0.01, 50),
    rotation: n(o.rotation, d.rotation, -3600, 3600),
    opacity: n(o.opacity, d.opacity, 0, 1),
    cropLeft: n(o.cropLeft, 0, 0, 0.45),
    cropRight: n(o.cropRight, 0, 0, 0.45),
    cropTop: n(o.cropTop, 0, 0, 0.45),
    cropBottom: n(o.cropBottom, 0, 0, 0.45),
    brightness: n(o.brightness, 0, -100, 100),
    contrast: n(o.contrast, 0, -100, 100),
    saturation: n(o.saturation, 0, -100, 100),
    hue: n(o.hue, 0, -180, 180),
    temperature: n(o.temperature, 0, -100, 100),
    blur: n(o.blur, 0, 0, 200),
    chromaKey: bool(o.chromaKey),
    chromaColor: color(o.chromaColor, d.chromaColor),
    chromaSimilarity: n(o.chromaSimilarity, d.chromaSimilarity, 0, 1),
    chromaSmoothness: n(o.chromaSmoothness, d.chromaSmoothness, 0, 1),
    shake: n(o.shake, 0, ...KEY_RANGES.shake),
    shakeSpeed: n(o.shakeSpeed, d.shakeSpeed, 0.5, 60),
    glow: n(o.glow, 0, ...KEY_RANGES.glow),
    glowRadius: n(o.glowRadius, d.glowRadius, 1, 200),
    rgbSplit: n(o.rgbSplit, 0, ...KEY_RANGES.rgbSplit),
    motionBlur: n(o.motionBlur, 0, ...KEY_RANGES.motionBlur),
    motionBlurAngle: n(o.motionBlurAngle, 0, -360, 360),
    zoomBlur: n(o.zoomBlur, 0, ...KEY_RANGES.zoomBlur),
    vignette: n(o.vignette, 0, ...KEY_RANGES.vignette),
    sharpen: n(o.sharpen, 0, ...KEY_RANGES.sharpen),
    grain: n(o.grain, 0, ...KEY_RANGES.grain),
    letterbox: n(o.letterbox, 0, ...KEY_RANGES.letterbox),
    rotateX: n(o.rotateX, 0, ...KEY_RANGES.rotateX),
    rotateY: n(o.rotateY, 0, ...KEY_RANGES.rotateY),
    z: n(o.z, 0, ...KEY_RANGES.z),
    perspective: n(o.perspective, d.perspective, 0.2, 20),
  };
}

export function parseMask(v: unknown): ClipMask | undefined {
  if (!isObj(v) || !['rectangle', 'ellipse', 'linear'].includes(v.shape as string)) return undefined;
  return {
    shape: v.shape as ClipMask['shape'],
    x: n(v.x, 0.5, -1, 2),
    y: n(v.y, 0.5, -1, 2),
    w: n(v.w, 0.6, 0.001, 4),
    h: n(v.h, 0.6, 0.001, 4),
    rotation: n(v.rotation, 0, -3600, 3600),
    feather: n(v.feather, 0, 0, 0.5),
    invert: bool(v.invert),
  };
}

/** A validated color grade (null-ish parts dropped); undefined when it does nothing. */
export function parseGrade(v: unknown, lutIds: Set<string>): ColorGrade | undefined {
  if (!isObj(v)) return undefined;
  const g: ColorGrade = { lookAmount: n(v.lookAmount, 1, 0, 1), lutAmount: n(v.lutAmount, 1, 0, 1) };
  if (LOOK_IDS.includes(v.look as LookId)) g.look = v.look as LookId;
  if (typeof v.lut === 'string' && lutIds.has(v.lut)) g.lut = v.lut;
  if (isObj(v.curves)) {
    const curves: Partial<Record<CurveChannel, [number, number][]>> = {};
    for (const ch of CURVE_CHANNELS) {
      const pts = cleanCurve(v.curves[ch]);
      if (pts && !isIdentityCurve(pts)) curves[ch] = pts;
    }
    if (Object.keys(curves).length) g.curves = curves;
  }
  if (isObj(v.hsl)) {
    const hsl: NonNullable<ColorGrade['hsl']> = {};
    for (const id of HUE_RANGE_IDS) {
      const a = v.hsl[id];
      if (!isObj(a)) continue;
      const adj = { h: n(a.h, 0, -30, 30), s: n(a.s, 0, -100, 100), l: n(a.l, 0, -100, 100) };
      if (adj.h || adj.s || adj.l) hsl[id as HueRange] = adj;
    }
    if (Object.keys(hsl).length) g.hsl = hsl;
  }
  return g.look || g.lut || g.curves || g.hsl ? g : undefined;
}

/** Sound effects of an audio clip; undefined when they do nothing. */
export function parseAudioFx(v: unknown): AudioFx | undefined {
  if (!isObj(v)) return undefined;
  const d = DEFAULT_AUDIO_FX;
  const fx: AudioFx = {
    highPass: n(v.highPass, 0, 0, 20000),
    lowPass: n(v.lowPass, 0, 0, 22000),
    eqLow: n(v.eqLow, 0, -24, 24),
    eqMid: n(v.eqMid, 0, -24, 24),
    eqHigh: n(v.eqHigh, 0, -24, 24),
    reverb: n(v.reverb, 0, 0, 1),
    reverbSize: n(v.reverbSize, d.reverbSize, 0.2, 8),
  };
  return fx.highPass || fx.lowPass || fx.eqLow || fx.eqMid || fx.eqHigh || fx.reverb ? fx : undefined;
}

/** Embedded fonts (plain family names, base64 data, at most 16 MB each). */
function parseFonts(v: unknown): FontAsset[] {
  const out: FontAsset[] = [];
  for (const f of Array.isArray(v) ? v.slice(0, 50) : []) {
    if (!isObj(f) || typeof f.id !== 'string' || typeof f.data !== 'string' || out.some((x) => x.id === f.id)) continue;
    const family = str(f.family, '', 120).replace(/["';{}<>\\]/g, '').trim();
    if (!family || f.data.length > 22_000_000 || !/^[A-Za-z0-9+/]+=*$/.test(f.data)) continue;
    out.push({ id: f.id.slice(0, 80), family, name: str(f.name, family, 200), data: f.data });
  }
  return out;
}

/** Imported LUTs whose data has the right length. */
function parseLuts(v: unknown): LutAsset[] {
  const out: LutAsset[] = [];
  for (const l of Array.isArray(v) ? v.slice(0, 100) : []) {
    if (!isObj(l) || typeof l.id !== 'string' || typeof l.data !== 'string' || out.some((x) => x.id === l.id)) continue;
    const size = Math.round(n(l.size, 0, 0, 65));
    if (size < 2 || l.data.length !== Math.ceil((size ** 3 * 6) / 3) * 4 || !/^[A-Za-z0-9+/]+=*$/.test(l.data)) continue;
    out.push({ id: l.id.slice(0, 80), name: str(l.name, 'LUT', 200), size, data: l.data });
  }
  return out;
}

export function parseTitle(v: unknown, frameHeight: number): TitleStyle {
  const o = isObj(v) ? v : {};
  const d = defaultTitle(frameHeight);
  const align = o.align === 'left' || o.align === 'right' || o.align === 'center' ? o.align : d.align;
  const anim = ['none', 'fade', 'slideUp', 'pop', 'typewriter'].includes(o.animation as string) ? (o.animation as TitleStyle['animation']) : d.animation;
  return {
    text: str(o.text, d.text, 2000),
    subtitle: str(o.subtitle, '', 1000),
    font: str(o.font, d.font, 120).replace(/["';{}<>]/g, '') || d.font,
    size: n(o.size, d.size, 4, 2000),
    weight: Math.round(n(o.weight, d.weight, 100, 900) / 100) * 100,
    italic: bool(o.italic),
    color: color(o.color, d.color),
    outlineColor: color(o.outlineColor, d.outlineColor),
    outlineWidth: n(o.outlineWidth, 0, 0, 200),
    box: bool(o.box),
    boxColor: color(o.boxColor, d.boxColor),
    shadow: bool(o.shadow, d.shadow),
    align,
    x: n(o.x, d.x, -1, 2),
    y: n(o.y, d.y, -1, 2),
    animation: anim,
    animDuration: n(o.animDuration, d.animDuration, 0.05, 10),
    extrude: n(o.extrude, 0, 0, 400) || undefined,
    extrudeColor: typeof o.extrudeColor === 'string' ? color(o.extrudeColor, '#000000') : undefined,
  };
}

export function parseCaptionStyle(v: unknown, frameHeight: number): CaptionStyle {
  const o = isObj(v) ? v : {};
  const d = defaultCaptionStyle(frameHeight);
  return {
    font: str(o.font, d.font, 120).replace(/["';{}<>]/g, '') || d.font,
    size: n(o.size, d.size, 6, 1000),
    weight: Math.round(n(o.weight, d.weight, 100, 900) / 100) * 100,
    color: color(o.color, d.color),
    outlineColor: color(o.outlineColor, d.outlineColor),
    outlineWidth: n(o.outlineWidth, d.outlineWidth, 0, 100),
    box: bool(o.box, d.box),
    boxColor: color(o.boxColor, d.boxColor),
    position: o.position === 'top' ? 'top' : 'bottom',
    margin: n(o.margin, d.margin, 0, 0.45),
    maxWidth: n(o.maxWidth, d.maxWidth, 0.2, 1),
  };
}

function parseTransition(v: unknown): Transition | undefined {
  if (!isObj(v) || !TRANSITION_KINDS.includes(v.kind as Transition['kind'])) return undefined;
  return { kind: v.kind as Transition['kind'], duration: n(v.duration, 1, 0.05, 10) };
}

const CLIP_KINDS: ClipKind[] = ['video', 'audio', 'image', 'title', 'caption', 'adjustment'];

/** Parses and validates a saved project. Throws an Error with a readable message. */
export function parseProject(input: string | unknown): Project {
  let data: unknown = input;
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input);
    } catch {
      throw new Error('This file is not a valid Ultima project (broken JSON).');
    }
  }
  if (!isObj(data) || data.app !== 'ultima') throw new Error('This file is not an Ultima project.');
  if (data.module !== 'video') throw new Error(`This project belongs to another module (${String(data.module)}).`);
  const s = isObj(data.settings) ? data.settings : {};
  const even = (v: number) => Math.max(16, Math.round(v / 2) * 2);
  const settings = {
    width: even(n(s.width, DEFAULT_SETTINGS.width, 16, 7680)),
    height: even(n(s.height, DEFAULT_SETTINGS.height, 16, 7680)),
    fps: Math.round(n(s.fps, DEFAULT_SETTINGS.fps, 1, 120)),
    background: color(s.background, DEFAULT_SETTINGS.background),
  };
  const base = createProject(settings, str(data.name, 'Untitled', 200) || 'Untitled');

  const media: MediaRef[] = [];
  const mediaIds = new Set<string>();
  for (const m of Array.isArray(data.media) ? data.media : []) {
    if (!isObj(m) || typeof m.id !== 'string' || mediaIds.has(m.id)) continue;
    const kind = m.kind === 'video' || m.kind === 'audio' || m.kind === 'image' ? m.kind : null;
    if (!kind) continue;
    mediaIds.add(m.id);
    media.push({
      id: m.id,
      name: str(m.name, 'media', 500),
      kind,
      duration: n(m.duration, 0, 0, 1e7),
      width: n(m.width, 0, 0, 100000),
      height: n(m.height, 0, 0, 100000),
      size: n(m.size, 0, 0, 1e15),
      mime: str(m.mime, '', 200),
      hasAudio: bool(m.hasAudio, kind !== 'image'),
      fps: kind === 'video' && typeof m.fps === 'number' && m.fps > 0 && m.fps <= 1000 ? m.fps : undefined,
      path: typeof m.path === 'string' ? m.path.slice(0, 4000) : undefined,
      lastModified: typeof m.lastModified === 'number' ? m.lastModified : undefined,
    });
  }

  const tracks: Track[] = [];
  for (const t of Array.isArray(data.tracks) ? data.tracks : []) {
    if (!isObj(t) || typeof t.id !== 'string' || tracks.some((x) => x.id === t.id)) continue;
    const kind = t.kind === 'video' || t.kind === 'audio' || t.kind === 'caption' ? t.kind : null;
    if (!kind) continue;
    tracks.push({
      id: t.id,
      kind,
      name: str(t.name, kind, 60),
      muted: bool(t.muted),
      hidden: bool(t.hidden),
      locked: bool(t.locked),
      solo: bool(t.solo),
    });
  }
  const finalTracks = tracks.length ? tracks : base.tracks;
  const trackKind = new Map(finalTracks.map((t) => [t.id, t.kind]));

  const luts = parseLuts(data.luts);
  const lutIds = new Set(luts.map((l) => l.id));
  const clips: Clip[] = [];
  const clipIds = new Set<string>();
  for (const c of Array.isArray(data.clips) ? data.clips : []) {
    if (!isObj(c) || typeof c.id !== 'string' || clipIds.has(c.id)) continue;
    const kind = CLIP_KINDS.includes(c.kind as ClipKind) ? (c.kind as ClipKind) : null;
    if (!kind || typeof c.trackId !== 'string' || trackKind.get(c.trackId) !== trackKindForClip(kind)) continue;
    const mediaId = typeof c.mediaId === 'string' && mediaIds.has(c.mediaId) ? c.mediaId : undefined;
    if ((kind === 'video' || kind === 'audio' || kind === 'image') && !mediaId) continue;
    const duration = n(c.duration, 0, 0, 1e7);
    if (duration <= 0) continue;
    clipIds.add(c.id);
    const visualKind = kind === 'video' || kind === 'image' || kind === 'title' || kind === 'adjustment';
    clips.push({
      id: c.id,
      kind,
      trackId: c.trackId,
      name: str(c.name, kind, 300),
      start: n(c.start, 0, 0, 1e7),
      duration,
      mediaId,
      in: n(c.in, 0, 0, 1e7),
      speed: n(c.speed, 1, MIN_SPEED, MAX_SPEED),
      keepPitch: bool(c.keepPitch, true),
      volume: n(c.volume, 0, MIN_VOLUME_DB, MAX_VOLUME_DB),
      fadeIn: n(c.fadeIn, 0, 0, duration),
      fadeOut: n(c.fadeOut, 0, 0, duration),
      linkId: typeof c.linkId === 'string' ? c.linkId.slice(0, 80) : undefined,
      transition: visualKind ? parseTransition(c.transition) : undefined,
      transitionOut: visualKind ? parseTransition(c.transitionOut) : undefined,
      visual: visualKind ? parseVisual(c.visual) : undefined,
      blend: visualKind && BLEND_IDS.includes(c.blend as BlendMode) && c.blend !== 'normal' ? (c.blend as BlendMode) : undefined,
      mask: visualKind ? parseMask(c.mask) : undefined,
      grade: visualKind ? parseGrade(c.grade, lutIds) : undefined,
      audioFx: kind === 'audio' ? parseAudioFx(c.audioFx) : undefined,
      title: kind === 'title' ? parseTitle(c.title, settings.height) : undefined,
      text: kind === 'caption' ? str(c.text, '', 2000) : undefined,
      keys: parseKeys(c.keys, duration, visualKind, kind === 'audio'),
      speedKeys: kind === 'video' || kind === 'audio' ? parseKeyList(c.speedKeys, [MIN_SPEED, MAX_SPEED], duration) : undefined,
      reverse: (kind === 'video' || kind === 'audio') && c.reverse === true ? true : undefined,
      freeze: (kind === 'video' || kind === 'audio') && c.freeze === true ? true : undefined,
      frameBlend: kind === 'video' && c.frameBlend === true ? true : undefined,
      opticalFlow: kind === 'video' && c.opticalFlow === true ? true : undefined,
      tracks: kind === 'video' ? parseMotionTracks(c.tracks) : undefined,
      matte: kind === 'video' ? parseMatte(c.matte) : undefined,
    });
  }

  const markers = (Array.isArray(data.markers) ? data.markers : [])
    .filter(isObj)
    .filter((m) => typeof m.id === 'string')
    .map((m) => ({ id: m.id as string, time: n(m.time, 0, 0, 1e7), label: str(m.label, '', 200) }))
    .sort((a, b) => a.time - b.time);

  let workArea: Project['workArea'] = null;
  if (isObj(data.workArea)) {
    const a = n(data.workArea.start, NaN);
    const b = n(data.workArea.end, NaN);
    if (Number.isFinite(a) && Number.isFinite(b) && b > a && a >= 0) workArea = { start: a, end: b };
  }

  return {
    ...base,
    media,
    tracks: finalTracks,
    clips: normalizeLinks(clips),
    markers,
    workArea,
    captionStyle: parseCaptionStyle(data.captionStyle, settings.height),
    luts,
    fonts: parseFonts(data.fonts),
  };
}
