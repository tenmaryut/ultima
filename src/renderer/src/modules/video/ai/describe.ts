import type { Clip, Project } from '../types';
import { clipEnd, getMedia, getTrack, sourceOut, timelineDuration } from '../model';
import { formatTimecode } from '../time';
import type { MediaAnalysis } from '../analysisStore';

/* The CURRENT DOCUMENT text the Video Editor AI reads before every request. */

export interface DescribeContext {
  playhead: number;
  selection: string[];
  /** Font families available for titles. */
  fonts?: string[];
  /** Content analysis of a media item ('pending' while it runs). */
  analysis?: (mediaId: string) => MediaAnalysis | 'pending' | null;
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

/** Source seconds of a clip's media on the timeline, or null when that part isn't used. */
function onTimeline(c: Clip, source: number): number | null {
  const t = c.start + (source - c.in) / c.speed;
  return t >= c.start - 1e-6 && t <= clipEnd(c) + 1e-6 ? t : null;
}

function times(c: Clip, source: number[], max: number): string {
  const tl = source.map((x) => onTimeline(c, x)).filter((x): x is number => x !== null);
  if (!tl.length) return '';
  return tl.slice(0, max).map(s2).join(', ') + (tl.length > max ? ` … (+${tl.length - max} more)` : '');
}

/** What the analysis found in each clip on the timeline, in timeline seconds. */
function analysisLines(p: Project, ctx: DescribeContext): string[] {
  if (!ctx.analysis) return [];
  const lines: string[] = [];
  const pending: string[] = [];
  const clips = p.clips.filter((c) => (c.kind === 'video' || c.kind === 'audio') && c.mediaId).sort((a, b) => a.start - b.start);
  for (const c of clips) {
    // a video's own sound is described with the video clip
    if (c.kind === 'audio' && c.linkId && p.clips.some((o) => o.linkId === c.linkId && o.kind === 'video')) continue;
    const a = ctx.analysis(c.mediaId!);
    if (a === 'pending') {
      pending.push(c.id);
      continue;
    }
    if (!a) continue;
    const parts: string[] = [];
    const au = a.audio;
    const b = au?.beats;
    if (b && (c.kind === 'audio' || b.confidence >= 0.3)) {
      const beats = times(c, b.beats, 48);
      if (beats) {
        parts.push(`≈${Math.round((b.bpm * c.speed) * 10) / 10} BPM (a beat every ${(b.period / c.speed).toFixed(3)} s, steadiness ${b.confidence})`);
        parts.push(`beats: ${beats}`);
        const bars = times(c, b.downbeats, 16);
        if (bars) parts.push(`bar starts: ${bars}`);
      }
    }
    if (au?.hits.length) {
      const hits = times(c, au.hits, 12);
      if (hits) parts.push(`strongest hits: ${hits}`);
    }
    if (au?.rises.length) {
      const rises = times(c, au.rises, 6);
      if (rises) parts.push(`gets louder at: ${rises}`);
    }
    if (au?.loud.length) {
      const loud = au.loud
        .map((m) => ({ t: onTimeline(c, m.time), m }))
        .filter((x): x is { t: number; m: (typeof au.loud)[number] } => x.t !== null)
        .slice(0, 16)
        .map((x) => `${s2(x.t)} (+${x.m.prominence} dB)`);
      if (loud.length) parts.push(`loud moments: ${loud.join(', ')}`);
    }
    if (au?.bursts.length) {
      const bursts = au.bursts
        .map((x) => ({ s: onTimeline(c, x.start), e: onTimeline(c, x.end), n: x.count }))
        .filter((x) => x.s !== null && x.e !== null)
        .slice(0, 8)
        .map((x) => `${s2(x.s!)}–${s2(x.e!)} (${x.n} hits)`);
      if (bursts.length) parts.push(`bursts: ${bursts.join(', ')}`);
    }
    if (a.scenes) {
      const cuts = times(c, a.scenes.cuts, 20);
      if (cuts) parts.push(`scene changes: ${cuts}`);
      const busy = times(c, a.scenes.busiest, 5);
      if (busy) parts.push(`most movement: ${busy}`);
    }
    if (!parts.length) continue;
    const media = getMedia(p, c.mediaId);
    const partial = media && a.analysedSeconds < media.duration - 0.5 ? ` [only the first ${Math.round(a.analysedSeconds)} s of the file were analysed]` : '';
    lines.push(`- ${c.id} ${c.kind} "${c.name}" (${getTrack(p, c.trackId)?.name ?? '?'}): ${parts.join('; ')}${partial}`);
  }
  if (lines.length) lines.unshift('Analysis (timeline seconds, approximate — check with look):');
  if (pending.length) lines.push(`Analysis still running for ${pending.join(', ')}.`);
  return lines;
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
  lines.push(...analysisLines(p, ctx));
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
