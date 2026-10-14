import type { Clip, Keyframe, KeyProp, Project } from '../types';
import { clipEnd, getMedia, getTrack, sourceOut, timelineDuration } from '../model';
import { KEY_PROPS, speedAt, timeOfSource } from '../keyframes';
import { EFFECT_PROPS } from '../presets';
import { isLibraryMedia } from '../library';
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

/** "0=1 → 1.2=1.3 (easeOut) → 2=1": keyframe times are seconds from the clip start. */
function keyList(keys: Keyframe[], digits: number): string {
  const list = keys.slice(0, 10).map((k) => `${+k.t.toFixed(2)}=${+k.v.toFixed(digits)}${k.ease !== 'easeInOut' && k !== keys[keys.length - 1] ? ` (${k.ease})` : ''}`);
  return list.join(' → ') + (keys.length > 10 ? ` … (+${keys.length - 10} more)` : '');
}

const KEY_DIGITS: Partial<Record<KeyProp, number>> = { x: 0, y: 0, rotation: 1, opacity: 2, scale: 3, volume: 1, lowPass: 0, glow: 2, zoomBlur: 2, vignette: 2, sharpen: 2, grain: 2, letterbox: 3 };

function gradeSummary(c: Clip, p: Project): string {
  const g = c.grade;
  if (!g) return '';
  const parts: string[] = [];
  if (g.look) parts.push(`look ${g.look}${g.lookAmount < 1 ? ` ${Math.round(g.lookAmount * 100)}%` : ''}`);
  if (g.lut) parts.push(`LUT ${g.lut} "${p.luts.find((l) => l.id === g.lut)?.name ?? '?'}"${g.lutAmount < 1 ? ` ${Math.round(g.lutAmount * 100)}%` : ''}`);
  if (g.curves) parts.push(`curves ${Object.entries(g.curves).map(([ch, pts]) => `${ch} ${pts!.map(([x, y]) => `${+x.toFixed(2)}→${+y.toFixed(2)}`).join(' ')}`).join('; ')}`);
  if (g.hsl) parts.push(`hsl ${Object.entries(g.hsl).map(([r, a]) => `${r} h${a!.h} s${a!.s} l${a!.l}`).join(', ')}`);
  return parts.join(', ');
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
    const crop = [v.cropLeft, v.cropRight, v.cropTop, v.cropBottom];
    if (crop.some(Boolean)) parts.push(`crop L${s2(v.cropLeft)} R${s2(v.cropRight)} T${s2(v.cropTop)} B${s2(v.cropBottom)}`);
    if (v.chromaKey) parts.push(`chroma key ${v.chromaColor}`);
  }
  if (c.freeze) parts.push('freeze frame (still)');
  else if (c.speedKeys?.length) parts.push(`speed ramp (clip seconds=speed) ${keyList(c.speedKeys, 2)}`);
  else if (c.speed !== 1) parts.push(`speed ${c.speed}x`);
  if (c.reverse) parts.push('reversed');
  if (c.frameBlend) parts.push('smooth slow motion (frame blending)');
  if ((c.kind === 'audio' || c.kind === 'video') && !c.keepPitch && c.speed !== 1 && !c.speedKeys?.length) parts.push('pitch follows speed');
  if (c.kind === 'audio' && c.volume) parts.push(`volume ${c.volume.toFixed(1)} dB`);
  const fx = c.audioFx;
  if (fx) {
    const sound = [
      fx.highPass && `low cut ${Math.round(fx.highPass)} Hz`,
      fx.lowPass && `high cut ${Math.round(fx.lowPass)} Hz`,
      fx.eqLow && `bass ${fx.eqLow > 0 ? '+' : ''}${fx.eqLow} dB`,
      fx.eqMid && `mids ${fx.eqMid > 0 ? '+' : ''}${fx.eqMid} dB`,
      fx.eqHigh && `treble ${fx.eqHigh > 0 ? '+' : ''}${fx.eqHigh} dB`,
      fx.reverb && `reverb ${Math.round(fx.reverb * 100)}% ${fx.reverbSize}s`,
    ].filter(Boolean);
    if (sound.length) parts.push(`sound: ${sound.join(', ')}`);
  }
  if (c.fadeIn) parts.push(`fade in ${s2(c.fadeIn)}s`);
  if (c.fadeOut) parts.push(`fade out ${s2(c.fadeOut)}s`);
  if (c.transition) parts.push(`transition in ${c.transition.kind} ${c.transition.duration}s`);
  if (c.transitionOut) parts.push(`out-animation ${c.transitionOut.kind} ${c.transitionOut.duration}s`);
  if (v) {
    for (const e of EFFECT_PROPS) if (v[e.prop]) parts.push(`${e.prop} ${+v[e.prop].toFixed(3)}`);
    if (v.shake && v.shakeSpeed !== 12) parts.push(`shakeSpeed ${v.shakeSpeed}`);
    if (v.glow && v.glowRadius !== 24) parts.push(`glowRadius ${v.glowRadius}`);
    if (v.motionBlur && v.motionBlurAngle) parts.push(`motionBlurAngle ${v.motionBlurAngle}`);
  }
  if (c.blend) parts.push(`blend ${c.blend}`);
  if (c.mask) {
    const m = c.mask;
    parts.push(`mask ${m.shape}${m.invert ? ' inverted' : ''} at (${s2(m.x)}, ${s2(m.y)})${m.shape !== 'linear' ? ` size ${s2(m.w)}×${s2(m.h)}` : ''}${m.rotation ? ` rotated ${Math.round(m.rotation)}°` : ''}${m.feather ? ` feather ${s2(m.feather)}` : ''}`);
  }
  const keyed = KEY_PROPS.filter((k) => c.keys?.[k]?.length);
  if (keyed.length) parts.push(`keyframes (clip seconds=value): ${keyed.map((k) => `${k} ${keyList(c.keys![k]!, KEY_DIGITS[k] ?? 0)}`).join('; ')}`);
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
const onTimeline = timeOfSource;

function times(c: Clip, source: number[], max: number): string {
  // reversed clips meet their source backwards
  const tl = source
    .map((x) => onTimeline(c, x))
    .filter((x): x is number => x !== null)
    .sort((a, b) => a - b);
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
        if (c.speedKeys?.length) parts.push(`the tempo follows the speed ramp (${b.bpm} BPM at 1×)`);
        else parts.push(`≈${Math.round(b.bpm * c.speed * 10) / 10} BPM (a beat every ${(b.period / c.speed).toFixed(3)} s, steadiness ${b.confidence})`);
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
        .sort((x, y) => x.t - y.t)
        .slice(0, 16)
        .map((x) => `${s2(x.t)} (+${x.m.prominence} dB)`);
      if (loud.length) parts.push(`loud moments: ${loud.join(', ')}`);
    }
    if (au?.bursts.length) {
      const bursts = au.bursts
        .map((x) => ({ s: onTimeline(c, x.start), e: onTimeline(c, x.end), n: x.count }))
        .filter((x): x is { s: number; e: number; n: number } => x.s !== null && x.e !== null)
        .map((x) => ({ s: Math.min(x.s, x.e), e: Math.max(x.s, x.e), n: x.n }))
        .sort((x, y) => x.s - y.s)
        .slice(0, 8)
        .map((x) => `${s2(x.s)}–${s2(x.e)} (${x.n} hits)`);
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
    const label = c.kind === 'title' ? `"${(c.title?.text ?? '').slice(0, 60)}"` : c.kind === 'adjustment' ? `"${c.name}" (changes the tracks below it)` : `"${c.name}"`;
    let src = '';
    if ((c.kind === 'video' || c.kind === 'audio') && media) {
      if (c.freeze) src = ` | media ${media.id}, holds the frame at source ${s2(c.in)} s`;
      else {
        // a reversed clip grows at its end by showing source from before its in-point
        const left = c.reverse ? c.in : media.duration - sourceOut(c);
        const room = media.duration > 0 ? Math.max(0, left / Math.max(1e-6, speedAt(c, c.duration))) : 0;
        src = ` | media ${media.id}, source ${s2(c.in)}–${s2(sourceOut(c))} s of ${s2(media.duration)} s${c.reverse ? ' (played backwards)' : ''}${room > 0.05 ? ` (end can extend ${s2(room)} s)` : ''}`;
      }
    } else if (c.kind === 'image' && media) src = ` | media ${media.id}`;
    const fx = [effectsSummary(c), gradeSummary(c, p)].filter(Boolean).join(', ');
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
      lines.push(`- ${m.id} | ${m.kind} "${m.name}"${size}${len}${sound}${isLibraryMedia(m.id) ? ' | built-in library' : ''} | on the timeline ${uses.get(m.id) ?? 0}×`);
    }
    if (p.media.length > 60) lines.push(`… and ${p.media.length - 60} more media items.`);
  }
  if (p.luts.length) lines.push(`Imported LUTs: ${p.luts.map((l) => `${l.id} "${l.name}"`).join(', ')}.`);
  if (ctx.fonts?.length) {
    const list = ctx.fonts.slice(0, 60);
    lines.push(`Fonts for titles: ${list.join(', ')}${ctx.fonts.length > list.length ? ` and ${ctx.fonts.length - list.length} more` : ''}.`);
  }
  lines.push(ctx.selection.length ? `Selected clips: ${ctx.selection.join(', ')}.` : 'No clip selected.');
  return lines.join('\n');
}
