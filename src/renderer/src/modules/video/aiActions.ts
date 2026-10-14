import type { Clip, Project, TitleStyle, Track, TrackKind, TransitionKind } from './types';
import { FPS_OPTIONS, MAX_SPEED, MAX_VOLUME_DB, MIN_SPEED, MIN_VOLUME_DB, TITLE_PRESETS, TRANSITION_KINDS, titlePreset } from './presets';
import {
  addCaptionCues,
  addMarker,
  addTrack,
  changeSettings,
  clipEnd,
  deleteClips,
  findFreeVideoTrack,
  getClip,
  getMedia,
  getTrack,
  insertClips,
  isLockedTrack,
  makeClip,
  moveClips,
  setClipSpeed,
  splitAt,
  timelineDuration,
  tracksOfKind,
  trimClip,
  updateClip,
} from './model';
import { clampNum, formatTimecode } from './time';

/* AI assistant protocol for the Video Editor: instructions, context and a validating executor. */

export const VIDEO_AI_INSTRUCTIONS = `You edit a multi-track video timeline (like Premiere Pro). All times are in seconds. Positions are project pixels.
Tracks: V1, V2… are video tracks (higher numbers are drawn on top), A1, A2… audio tracks, C1… caption tracks.
Every clip has an id — always use the exact ids listed in CURRENT DOCUMENT. Video clips with sound have a linked audio clip that moves/trims/splits with them.

ACTIONS (objects in "actions", applied in order as ONE undo step):
1. {"type":"addTitle","text":string,"start":seconds,"duration":seconds,"style":STYLE,"position":POSITION}
   STYLE: "basic" | "lowerThird" | "big" | "subtitle" | "typewriter" | "pop" | "endCard", or an object
   {"preset"?:one of those, "font"?:string, "size"?:px, "weight"?:100-900, "color"?:"#rrggbb", "box"?:boolean, "boxColor"?:css color,
    "outlineColor"?:"#rrggbb", "outlineWidth"?:px, "animation"?:"none"|"fade"|"slideUp"|"pop"|"typewriter", "align"?:"left"|"center"|"right", "subtitle"?:second line}
   POSITION: "center" | "top" | "bottom" | "lower-left" | "upper-left" | "upper-right" | "lower-right" or {"x":0-1,"y":0-1} (fractions of the frame).
   The title is placed on a free video track above V1.
2. {"type":"addCaption","text":string,"start":seconds,"end":seconds}
3. {"type":"split","time":seconds,"clipId"?:id} — cuts that clip (and its linked audio), or every clip under that time.
4. {"type":"trim","clipId":id,"start"?:seconds,"end"?:seconds} — new timeline start and/or end of the clip (limited by the source length and neighbouring clips).
5. {"type":"move","clipId":id,"start":seconds,"track"?:"V2"|"A1"|… } — overwrites what is at the destination.
6. {"type":"delete","clipIds":[id,…],"ripple"?:boolean} — ripple=true closes the gap.
7. {"type":"setClip","clipId":id,"props":{…}} props (all optional): opacity 0-1, scale (1 = fitted to the frame, 0.05-10), x / y (px offset of the clip center from the frame center),
   rotation (degrees), volume (dB, -60..12, 0 = unchanged), speed (0.25-4), brightness / contrast / saturation (-100..100, 0 = neutral, saturation -100 = black and white),
   hue (-180..180), temperature (-100 cool .. 100 warm), blur (0-50 px), fadeIn / fadeOut (seconds), text (title or caption text), name.
8. {"type":"addTransition","clipId":id,"kind":"dissolve"|"dipBlack"|"dipWhite"|"wipeLeft"|"wipeRight"|"slide"|"zoom"|"none","duration":seconds 0.1-5} — transition into the clip at its start; "none" removes it.
9. {"type":"addMarker","time":seconds,"label":string}
10. {"type":"setProject","width"?:px,"height"?:px,"fps"?:24|25|30|50|60,"background"?:"#rrggbb"} — e.g. 1080×1920 for vertical video.

EXAMPLES
User: "Put a big title 'Summer Trip' over the first 3 seconds"
{"message":"Added the title.","actions":[{"type":"addTitle","text":"Summer Trip","start":0,"duration":3,"style":"big","position":"center"}]}
User: "Make clip c_ab12 black and white, fade it out and add a cross dissolve"
{"message":"Done — black and white with a fade out and a dissolve.","actions":[{"type":"setClip","clipId":"c_ab12","props":{"saturation":-100,"fadeOut":1}},{"type":"addTransition","clipId":"c_ab12","kind":"dissolve","duration":1}]}`;

/* ------------------------------- Context text ------------------------------ */

function trackLabel(p: Project, trackId: string): string {
  return getTrack(p, trackId)?.name ?? '?';
}

function effectsSummary(c: Clip): string {
  const parts: string[] = [];
  const v = c.visual;
  if (v) {
    if (v.opacity !== 1) parts.push(`opacity ${+v.opacity.toFixed(2)}`);
    if (v.scale !== 1) parts.push(`scale ${+v.scale.toFixed(2)}`);
    if (v.x || v.y) parts.push(`pos ${Math.round(v.x)},${Math.round(v.y)}`);
    if (v.rotation) parts.push(`rotation ${Math.round(v.rotation)}`);
    for (const k of ['brightness', 'contrast', 'saturation', 'hue', 'temperature', 'blur'] as const) if (v[k]) parts.push(`${k} ${Math.round(v[k])}`);
    if (v.chromaKey) parts.push('chroma key');
  }
  if (c.speed !== 1) parts.push(`speed ${c.speed}x`);
  if (c.kind === 'audio' && c.volume) parts.push(`volume ${c.volume.toFixed(1)} dB`);
  if (c.fadeIn) parts.push(`fade in ${c.fadeIn.toFixed(2)}s`);
  if (c.fadeOut) parts.push(`fade out ${c.fadeOut.toFixed(2)}s`);
  if (c.transition) parts.push(`transition ${c.transition.kind} ${c.transition.duration}s`);
  return parts.join(', ');
}

/** Plain-text summary of the project for the AI. */
export function describeProject(p: Project, ctx: { playhead: number; selection: string[] }): string {
  const { width, height, fps, background } = p.settings;
  const dur = timelineDuration(p);
  const lines: string[] = [
    `Project "${p.name}": ${width}×${height} px, ${fps} fps, background ${background}. Timeline length ${dur.toFixed(2)} s (${formatTimecode(dur, fps)}). Playhead at ${ctx.playhead.toFixed(2)} s.`,
    p.workArea ? `Work area: ${p.workArea.start.toFixed(2)}–${p.workArea.end.toFixed(2)} s.` : 'No work area set.',
    `Tracks: ${p.tracks
      .map((t) => `${t.name} (${t.kind}${t.hidden ? ', hidden' : ''}${t.muted ? ', muted' : ''}${t.solo ? ', solo' : ''}${t.locked ? ', locked' : ''})`)
      .join(', ')}.`,
  ];
  const nonCaption = p.clips.filter((c) => c.kind !== 'caption').sort((a, b) => a.start - b.start);
  lines.push(nonCaption.length ? `Clips (${nonCaption.length}):` : 'The timeline has no clips yet.');
  for (const c of nonCaption.slice(0, 160)) {
    const media = getMedia(p, c.mediaId);
    const label = c.kind === 'title' ? `"${(c.title?.text ?? '').slice(0, 60)}"` : `"${c.name}"`;
    const src = c.kind === 'video' || c.kind === 'audio' ? ` | source ${c.in.toFixed(2)}–${(c.in + c.duration * c.speed).toFixed(2)} s of ${media?.duration.toFixed(2) ?? '?'} s` : '';
    const fx = effectsSummary(c);
    lines.push(
      `- ${c.id} | ${c.kind} ${label} | ${trackLabel(p, c.trackId)} | ${c.start.toFixed(2)}–${clipEnd(c).toFixed(2)} s${src}${c.linkId ? ' | linked' : ''}${fx ? ` | ${fx}` : ''}`,
    );
  }
  if (nonCaption.length > 160) lines.push(`… and ${nonCaption.length - 160} more clips.`);
  const captions = p.clips.filter((c) => c.kind === 'caption').sort((a, b) => a.start - b.start);
  if (captions.length) {
    lines.push(`Captions (${captions.length}):`);
    for (const c of captions.slice(0, 40)) lines.push(`- ${c.id} | ${c.start.toFixed(2)}–${clipEnd(c).toFixed(2)} s | ${(c.text ?? '').slice(0, 100)}`);
    if (captions.length > 40) lines.push(`… and ${captions.length - 40} more captions.`);
  }
  if (p.markers.length) lines.push(`Markers: ${p.markers.map((m) => `${m.time.toFixed(2)} s "${m.label}"`).join(', ')}.`);
  if (p.media.length) {
    lines.push(
      `Media bin: ${p.media
        .slice(0, 40)
        .map((m) => `${m.name} (${m.kind}${m.kind !== 'audio' ? ` ${m.width}×${m.height}` : ''}${m.kind !== 'image' ? `, ${m.duration.toFixed(1)} s` : ''})`)
        .join('; ')}.`,
    );
  }
  lines.push(ctx.selection.length ? `Selected clips: ${ctx.selection.join(', ')}.` : 'No clip selected.');
  return lines.join('\n');
}

/* --------------------------------- Executor -------------------------------- */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Removes markup and control characters from AI text (it's drawn on canvas, never as HTML). */
export function plainText(v: unknown, max = 500): string {
  if (typeof v !== 'string') return '';
  return v
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, max);
}

const COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\)|[a-z]{3,20})$/i;
const safeColor = (v: unknown): string | undefined => (typeof v === 'string' && COLOR_RE.test(v.trim()) ? v.trim() : undefined);

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

/** Resolves "V2", "A1", a track id or a 1-based number to a track of `kind` (creating V3 etc. when asked for the next one). */
function resolveTrack(p: Project, ref: unknown, kind: TrackKind): { project: Project; track: Track | null } {
  const ofKind = tracksOfKind(p, kind);
  if (typeof ref === 'string') {
    const byId = ofKind.find((t) => t.id === ref);
    if (byId) return { project: p, track: byId };
    const byName = ofKind.find((t) => t.name.toLowerCase() === ref.trim().toLowerCase());
    if (byName) return { project: p, track: byName };
    const m = /^[vac]?(\d+)$/i.exec(ref.trim());
    if (m) return resolveTrack(p, parseInt(m[1], 10), kind);
    return { project: p, track: null };
  }
  if (finite(ref)) {
    const idx = Math.round(ref) - 1;
    if (idx >= 0 && idx < ofKind.length) return { project: p, track: ofKind[idx] };
    if (idx >= ofKind.length && idx < 12) {
      let project = p;
      let last: Track | null = null;
      for (let i = ofKind.length; i <= idx; i++) {
        const r = addTrack(project, kind);
        project = r.project;
        last = r.track;
      }
      return { project, track: last };
    }
  }
  return { project: p, track: null };
}

function buildTitle(p: Project, styleArg: unknown, position: unknown, text: string): TitleStyle {
  const { width, height } = p.settings;
  const presetName = typeof styleArg === 'string' ? styleArg : isObj(styleArg) && typeof styleArg.preset === 'string' ? styleArg.preset : 'basic';
  const preset = TITLE_PRESETS.some((x) => x.id === presetName) ? presetName : 'basic';
  const t: TitleStyle = { ...titlePreset(preset, width, height), text };
  if (isObj(styleArg)) {
    if (typeof styleArg.font === 'string') t.font = plainText(styleArg.font, 80).replace(/["';{}]/g, '') || t.font;
    if (finite(styleArg.size)) t.size = clampNum(styleArg.size, 8, height);
    if (finite(styleArg.weight)) t.weight = Math.round(clampNum(styleArg.weight, 100, 900) / 100) * 100;
    t.color = safeColor(styleArg.color) ?? t.color;
    if (typeof styleArg.box === 'boolean') t.box = styleArg.box;
    t.boxColor = safeColor(styleArg.boxColor) ?? t.boxColor;
    t.outlineColor = safeColor(styleArg.outlineColor) ?? t.outlineColor;
    if (finite(styleArg.outlineWidth)) t.outlineWidth = clampNum(styleArg.outlineWidth, 0, 40);
    if (['none', 'fade', 'slideUp', 'pop', 'typewriter'].includes(styleArg.animation as string)) t.animation = styleArg.animation as TitleStyle['animation'];
    if (styleArg.align === 'left' || styleArg.align === 'center' || styleArg.align === 'right') t.align = styleArg.align;
    if (typeof styleArg.subtitle === 'string') t.subtitle = plainText(styleArg.subtitle, 200);
  }
  if (typeof position === 'string' && POSITIONS[position]) Object.assign(t, POSITIONS[position]);
  else if (isObj(position) && finite(position.x) && finite(position.y)) {
    t.x = clampNum(position.x, 0, 1);
    t.y = clampNum(position.y, 0, 1);
  }
  return t;
}

export interface AIApplyResult {
  project: Project;
  applied: number;
  notes: string[];
}

/** Validates and applies AI actions. Never throws for bad input — bad actions are skipped with a note. */
export function applyAIActions(project: Project, actions: unknown[], ctx: { playhead: number }): AIApplyResult {
  let p = project;
  let applied = 0;
  const notes: string[] = [];
  const W = p.settings.width;
  const clipFor = (id: unknown): Clip | null => {
    const c = typeof id === 'string' ? getClip(p, id) : undefined;
    if (!c) {
      notes.push(`unknown clip ${String(id)}`);
      return null;
    }
    if (isLockedTrack(p, c.trackId)) {
      notes.push(`clip ${c.id} is on a locked track`);
      return null;
    }
    return c;
  };

  for (const raw of actions.slice(0, 200)) {
    if (!isObj(raw) || typeof raw.type !== 'string') continue;
    const a = raw;
    switch (a.type) {
      case 'addTitle': {
        const text = plainText(a.text, 300);
        if (!text) {
          notes.push('title without text');
          break;
        }
        const start = clampNum(finite(a.start) ? a.start : ctx.playhead, 0, 1e6);
        const duration = clampNum(finite(a.duration) ? a.duration : 4, 0.3, 600);
        const style = buildTitle(p, a.style, a.position, text);
        const r = findFreeVideoTrack(p, start, start + duration);
        const clip = makeClip('title', r.trackId, start, duration, { name: text.slice(0, 40), title: style });
        p = insertClips(r.project, [clip]);
        applied++;
        break;
      }
      case 'addCaption': {
        const text = plainText(a.text, 500);
        const start = finite(a.start) ? Math.max(0, a.start) : ctx.playhead;
        const end = finite(a.end) && a.end > start ? a.end : start + 3;
        if (!text) break;
        p = addCaptionCues(p, [{ start, end, text }]).project;
        applied++;
        break;
      }
      case 'split': {
        if (!finite(a.time)) break;
        let ids: string[] | undefined;
        if (a.clipId !== undefined) {
          const c = clipFor(a.clipId);
          if (!c) break;
          ids = [c.id];
        }
        const r = splitAt(p, a.time, ids);
        if (r.created.length) applied++;
        else notes.push(`nothing to split at ${a.time}s`);
        p = r.project;
        break;
      }
      case 'trim': {
        const c = clipFor(a.clipId);
        if (!c) break;
        if (finite(a.start)) p = trimClip(p, c.id, 'start', a.start);
        if (finite(a.end)) p = trimClip(p, c.id, 'end', a.end);
        applied++;
        break;
      }
      case 'move': {
        const c = clipFor(a.clipId);
        if (!c) break;
        const kind = getTrack(p, c.trackId)?.kind ?? 'video';
        let shift = 0;
        if (a.track !== undefined) {
          const r = resolveTrack(p, a.track, kind);
          p = r.project;
          if (r.track) {
            const list = tracksOfKind(p, kind);
            shift = list.findIndex((t) => t.id === r.track!.id) - list.findIndex((t) => t.id === c.trackId);
          } else notes.push(`unknown track ${String(a.track)}`);
        }
        const start = finite(a.start) ? Math.max(0, a.start) : c.start;
        p = moveClips(p, [c.id], start - c.start, shift, kind);
        applied++;
        break;
      }
      case 'delete': {
        const ids = (Array.isArray(a.clipIds) ? a.clipIds : typeof a.clipId === 'string' ? [a.clipId] : []).filter(
          (id): id is string => typeof id === 'string' && Boolean(getClip(p, id)),
        );
        if (!ids.length) {
          notes.push('no valid clips to delete');
          break;
        }
        p = deleteClips(p, ids, { ripple: a.ripple === true });
        applied++;
        break;
      }
      case 'setClip': {
        const c = clipFor(a.clipId);
        if (!c || !isObj(a.props)) break;
        const pr = a.props;
        if (finite(pr.speed) && (c.kind === 'video' || c.kind === 'audio')) p = setClipSpeed(p, c.id, clampNum(pr.speed, MIN_SPEED, MAX_SPEED));
        p = updateClip(p, c.id, (cl) => {
          const next: Clip = { ...cl };
          if (cl.visual) {
            const v = { ...cl.visual };
            if (finite(pr.opacity)) v.opacity = clampNum(pr.opacity > 1 ? pr.opacity / 100 : pr.opacity, 0, 1);
            if (finite(pr.scale)) v.scale = clampNum(pr.scale > 10 ? pr.scale / 100 : pr.scale, 0.05, 10);
            if (finite(pr.x)) v.x = clampNum(pr.x, -W * 4, W * 4);
            if (finite(pr.y)) v.y = clampNum(pr.y, -W * 4, W * 4);
            if (finite(pr.rotation)) v.rotation = clampNum(pr.rotation, -360, 360);
            for (const k of ['brightness', 'contrast', 'saturation', 'temperature'] as const) if (finite(pr[k])) v[k] = clampNum(pr[k] as number, -100, 100);
            if (finite(pr.hue)) v.hue = clampNum(pr.hue, -180, 180);
            if (finite(pr.blur)) v.blur = clampNum(pr.blur, 0, 50);
            next.visual = v;
          }
          if (finite(pr.volume) && cl.kind === 'audio') next.volume = clampNum(pr.volume, MIN_VOLUME_DB, MAX_VOLUME_DB);
          if (finite(pr.fadeIn)) next.fadeIn = clampNum(pr.fadeIn, 0, cl.duration);
          if (finite(pr.fadeOut)) next.fadeOut = clampNum(pr.fadeOut, 0, Math.max(0, cl.duration - next.fadeIn));
          if (typeof pr.text === 'string') {
            const text = plainText(pr.text, 2000);
            if (cl.kind === 'title' && cl.title && text) next.title = { ...cl.title, text };
            if (cl.kind === 'caption' && text) next.text = text;
          }
          if (typeof pr.name === 'string' && plainText(pr.name, 120)) next.name = plainText(pr.name, 120);
          return next;
        });
        // volume on a video clip applies to its linked audio
        if (finite(pr.volume) && c.kind === 'video' && c.linkId) {
          for (const partner of p.clips.filter((x) => x.linkId === c.linkId && x.kind === 'audio')) {
            p = updateClip(p, partner.id, (x) => ({ ...x, volume: clampNum(pr.volume as number, MIN_VOLUME_DB, MAX_VOLUME_DB) }));
          }
        }
        applied++;
        break;
      }
      case 'addTransition': {
        const c = clipFor(a.clipId);
        if (!c) break;
        if (!(c.kind === 'video' || c.kind === 'image' || c.kind === 'title')) {
          notes.push(`transitions only apply to video, image and title clips`);
          break;
        }
        if (a.kind === 'none') p = updateClip(p, c.id, (x) => ({ ...x, transition: undefined }));
        else if (TRANSITION_KINDS.includes(a.kind as TransitionKind)) {
          const duration = clampNum(finite(a.duration) ? a.duration : 1, 0.1, Math.min(5, c.duration));
          p = updateClip(p, c.id, (x) => ({ ...x, transition: { kind: a.kind as TransitionKind, duration } }));
        } else {
          notes.push(`unknown transition ${String(a.kind)}`);
          break;
        }
        applied++;
        break;
      }
      case 'addMarker': {
        if (!finite(a.time)) break;
        p = addMarker(p, Math.max(0, a.time), plainText(a.label, 100)).project;
        applied++;
        break;
      }
      case 'setProject': {
        const s = { ...p.settings };
        const even = (v: number) => Math.max(16, Math.min(7680, Math.round(v / 2) * 2));
        if (finite(a.width)) s.width = even(a.width);
        if (finite(a.height)) s.height = even(a.height);
        if (finite(a.fps)) s.fps = FPS_OPTIONS.reduce((best, f) => (Math.abs(f - (a.fps as number)) < Math.abs(best - (a.fps as number)) ? f : best), 30);
        s.background = safeColor(a.background) ?? s.background;
        p = changeSettings(p, s);
        applied++;
        break;
      }
      default:
        notes.push(`unsupported action "${a.type}"`);
    }
  }
  return { project: p, applied, notes };
}

/* ------------------------- AI feature result parsing ------------------------ */

export interface VideoMeta {
  titles: string[];
  description: string;
  chapters: { time: number; title: string }[];
  tags: string[];
}

/** Validates the JSON returned for "Write titles & description". */
export function parseVideoMeta(data: unknown, duration: number): VideoMeta {
  const o = isObj(data) ? data : {};
  const titles = (Array.isArray(o.titles) ? o.titles : []).map((t) => plainText(t, 120)).filter(Boolean).slice(0, 8);
  const description = plainText(o.description, 5000);
  let chapters = (Array.isArray(o.chapters) ? o.chapters : [])
    .filter(isObj)
    .map((c) => ({ time: finite(c.time) ? clampNum(c.time, 0, Math.max(0, duration)) : NaN, title: plainText(c.title, 100) }))
    .filter((c) => Number.isFinite(c.time) && c.title)
    .sort((a, b) => a.time - b.time);
  chapters = chapters.filter((c, i) => i === 0 || c.time - chapters[i - 1].time >= 1);
  if (chapters.length && chapters[0].time > 0) chapters[0] = { ...chapters[0], time: 0 };
  const tags = (Array.isArray(o.tags) ? o.tags : []).map((t) => plainText(t, 40)).filter(Boolean).slice(0, 20);
  return { titles, description, chapters, tags };
}

/** "0:00 Intro" lines in YouTube chapter format. */
export function formatChapters(chapters: { time: number; title: string }[]): string {
  return chapters
    .map((c) => {
      const h = Math.floor(c.time / 3600);
      const m = Math.floor((c.time % 3600) / 60);
      const s = Math.floor(c.time % 60);
      const stamp = h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
      return `${stamp} ${c.title}`;
    })
    .join('\n');
}

/** Validates a rough-cut answer: indices of transcript segments to remove. */
export function parseRoughCut(data: unknown, segmentCount: number): { remove: number[]; reason: string } {
  const o = isObj(data) ? data : {};
  const remove = [...new Set((Array.isArray(o.remove) ? o.remove : []).filter(finite).map((v) => Math.round(v)))]
    .filter((i) => i >= 0 && i < segmentCount)
    .sort((a, b) => a - b);
  return { remove, reason: plainText(o.reason, 600) };
}
