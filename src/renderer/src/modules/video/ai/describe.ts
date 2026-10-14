import type { Clip, Project } from '../types';
import { clipEnd, getMedia, getTrack, sourceOut, timelineDuration } from '../model';
import { formatTimecode } from '../time';

/* The CURRENT DOCUMENT text the Video Editor AI reads before every request. */

export interface DescribeContext {
  playhead: number;
  selection: string[];
  /** Font families available for titles. */
  fonts?: string[];
}

const s2 = (t: number) => t.toFixed(2);

function effectsSummary(c: Clip): string {
  const parts: string[] = [];
  const v = c.visual;
  if (v) {
    if (v.opacity !== 1) parts.push(`opacity ${+v.opacity.toFixed(2)}`);
    if (v.scale !== 1) parts.push(`scale ${+v.scale.toFixed(2)}`);
    if (v.x || v.y) parts.push(`pos ${Math.round(v.x)},${Math.round(v.y)}`);
    if (v.rotation) parts.push(`rotation ${Math.round(v.rotation)}`);
    for (const k of ['brightness', 'contrast', 'saturation', 'hue', 'temperature', 'blur'] as const) if (v[k]) parts.push(`${k} ${Math.round(v[k])}`);
    const crop = [v.cropLeft, v.cropRight, v.cropTop, v.cropBottom];
    if (crop.some(Boolean)) parts.push(`crop L${s2(v.cropLeft)} R${s2(v.cropRight)} T${s2(v.cropTop)} B${s2(v.cropBottom)}`);
    if (v.chromaKey) parts.push(`chroma key ${v.chromaColor}`);
  }
  if (c.speed !== 1) parts.push(`speed ${c.speed}x`);
  if ((c.kind === 'audio' || c.kind === 'video') && !c.keepPitch && c.speed !== 1) parts.push('pitch follows speed');
  if (c.kind === 'audio' && c.volume) parts.push(`volume ${c.volume.toFixed(1)} dB`);
  if (c.fadeIn) parts.push(`fade in ${s2(c.fadeIn)}s`);
  if (c.fadeOut) parts.push(`fade out ${s2(c.fadeOut)}s`);
  if (c.transition) parts.push(`transition in ${c.transition.kind} ${c.transition.duration}s`);
  return parts.join(', ');
}

function titleSummary(c: Clip): string {
  const t = c.title;
  if (!t) return '';
  const extras = [t.subtitle && `subtitle "${t.subtitle.slice(0, 40)}"`, t.box && `box ${t.boxColor}`, t.outlineWidth && `outline ${t.outlineWidth}px ${t.outlineColor}`]
    .filter(Boolean)
    .join(', ');
  return ` | style ${t.font} ${Math.round(t.size)}px w${t.weight} ${t.color}, at (${s2(t.x)}, ${s2(t.y)}) ${t.align}, anim ${t.animation}${extras ? `, ${extras}` : ''}`;
}

/** Plain-text summary of the project for the AI. */
export function describeProject(p: Project, ctx: DescribeContext): string {
  const { width, height, fps, background } = p.settings;
  const dur = timelineDuration(p);
  const lines: string[] = [
    `Project "${p.name}": ${width}×${height} px, ${fps} fps, background ${background}. Timeline length ${dur.toFixed(2)} s (${formatTimecode(dur, fps)}). Playhead at ${ctx.playhead.toFixed(2)} s.`,
    p.workArea ? `Work area: ${p.workArea.start.toFixed(2)}–${p.workArea.end.toFixed(2)} s.` : 'No work area set.',
    `Tracks (higher V numbers draw on top): ${p.tracks
      .map((t) => `${t.name} (${t.kind}${t.hidden ? ', hidden' : ''}${t.muted ? ', muted' : ''}${t.solo ? ', solo' : ''}${t.locked ? ', locked' : ''})`)
      .join(', ')}.`,
  ];
  const nonCaption = p.clips.filter((c) => c.kind !== 'caption').sort((a, b) => a.start - b.start);
  lines.push(nonCaption.length ? `Clips (${nonCaption.length}):` : 'The timeline has no clips yet.');
  for (const c of nonCaption.slice(0, 160)) {
    const media = getMedia(p, c.mediaId);
    const label = c.kind === 'title' ? `"${(c.title?.text ?? '').slice(0, 60)}"` : `"${c.name}"`;
    let src = '';
    if ((c.kind === 'video' || c.kind === 'audio') && media) {
      const room = media.duration > 0 ? Math.max(0, (media.duration - sourceOut(c)) / c.speed) : 0;
      src = ` | media ${media.id}, source ${s2(c.in)}–${s2(sourceOut(c))} s of ${s2(media.duration)} s${room > 0.05 ? ` (end can extend ${s2(room)} s)` : ''}`;
    } else if (c.kind === 'image' && media) src = ` | media ${media.id}`;
    const fx = effectsSummary(c);
    lines.push(
      `- ${c.id} | ${c.kind} ${label} | ${getTrack(p, c.trackId)?.name ?? '?'} | ${s2(c.start)}–${s2(clipEnd(c))} s${src}${c.linkId ? ` | linked ${c.linkId}` : ''}${fx ? ` | ${fx}` : ''}${c.kind === 'title' ? titleSummary(c) : ''}`,
    );
  }
  if (nonCaption.length > 160) lines.push(`… and ${nonCaption.length - 160} more clips.`);
  const captions = p.clips.filter((c) => c.kind === 'caption').sort((a, b) => a.start - b.start);
  if (captions.length) {
    const cs = p.captionStyle;
    lines.push(`Captions (${captions.length}; style ${cs.font} ${Math.round(cs.size)}px ${cs.color}, ${cs.position}${cs.box ? ', box' : ''}):`);
    for (const c of captions.slice(0, 40)) lines.push(`- ${c.id} | ${s2(c.start)}–${s2(clipEnd(c))} s | ${(c.text ?? '').slice(0, 100)}`);
    if (captions.length > 40) lines.push(`… and ${captions.length - 40} more captions.`);
  }
  if (p.markers.length) {
    lines.push(
      `Markers: ${p.markers
        .map((m) => `${m.id} at ${s2(m.time)} s "${m.label}"${m.time > dur + 1e-6 ? ' (after the end of the timeline)' : ''}`)
        .join(', ')}.`,
    );
  }
  if (p.media.length) {
    const uses = new Map<string, number>();
    for (const c of p.clips) if (c.mediaId && c.kind !== 'audio') uses.set(c.mediaId, (uses.get(c.mediaId) ?? 0) + 1);
    for (const c of p.clips) if (c.mediaId && c.kind === 'audio' && !c.linkId) uses.set(c.mediaId, (uses.get(c.mediaId) ?? 0) + 1);
    lines.push(`Media bin (${p.media.length}):`);
    for (const m of p.media.slice(0, 60)) {
      const size = m.kind !== 'audio' && m.width ? ` ${m.width}×${m.height}` : '';
      const len = m.kind !== 'image' ? `, ${m.duration.toFixed(1)} s` : '';
      const sound = m.kind === 'video' ? (m.hasAudio ? ', with sound' : ', no sound') : '';
      lines.push(`- ${m.id} | ${m.kind} "${m.name}"${size}${len}${sound} | on the timeline ${uses.get(m.id) ?? 0}×`);
    }
    if (p.media.length > 60) lines.push(`… and ${p.media.length - 60} more media items.`);
  }
  if (ctx.fonts?.length) {
    const list = ctx.fonts.slice(0, 60);
    lines.push(`Fonts for titles: ${list.join(', ')}${ctx.fonts.length > list.length ? ` and ${ctx.fonts.length - list.length} more` : ''}.`);
  }
  lines.push(ctx.selection.length ? `Selected clips: ${ctx.selection.join(', ')}.` : 'No clip selected.');
  return lines.join('\n');
}
