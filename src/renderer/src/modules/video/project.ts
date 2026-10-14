import type { CaptionStyle, Clip, ClipKind, Easing, Keyframe, KeyProp, MediaRef, Project, TitleStyle, Track, Transition, VisualProps } from './types';
import { EASINGS, KEY_PROPS, KEY_RANGES } from './keyframes';
import { DEFAULT_SETTINGS, DEFAULT_VISUAL, MAX_SPEED, MAX_VOLUME_DB, MIN_SPEED, MIN_VOLUME_DB, TRANSITION_KINDS, defaultCaptionStyle, defaultTitle } from './presets';
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

function parseKeys(v: unknown, maxT: number, visual: boolean, audio: boolean): Clip['keys'] {
  if (!isObj(v)) return undefined;
  const out: Partial<Record<KeyProp, Keyframe[]>> = {};
  for (const k of KEY_PROPS) {
    if (k === 'volume' ? !audio : !visual) continue;
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
  };
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

const CLIP_KINDS: ClipKind[] = ['video', 'audio', 'image', 'title', 'caption'];

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
    const visualKind = kind === 'video' || kind === 'image' || kind === 'title';
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
      visual: visualKind ? parseVisual(c.visual) : undefined,
      title: kind === 'title' ? parseTitle(c.title, settings.height) : undefined,
      text: kind === 'caption' ? str(c.text, '', 2000) : undefined,
      keys: parseKeys(c.keys, duration, visualKind, kind === 'audio'),
      speedKeys: kind === 'video' || kind === 'audio' ? parseKeyList(c.speedKeys, [MIN_SPEED, MAX_SPEED], duration) : undefined,
      reverse: (kind === 'video' || kind === 'audio') && c.reverse === true ? true : undefined,
      freeze: (kind === 'video' || kind === 'audio') && c.freeze === true ? true : undefined,
      frameBlend: kind === 'video' && c.frameBlend === true ? true : undefined,
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
  };
}
