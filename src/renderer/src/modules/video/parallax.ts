import type { Clip, Easing, Keyframe, Project } from './types';
import { animatedVisual } from './keyframes';
import { clipEnd, getClip, updateClip } from './model';

/*
 * Parallax (pure, unit tested): a camera move over layers at different depths — the far ones move a little, the
 * near ones a lot — written as position and scale keyframes, so a photo cut into a foreground and a background (or
 * titles over footage) looks three-dimensional.
 */

export interface ParallaxLayer {
  clipId: string;
  /** 0 = far away (moves least) … 1 = right in front (moves most). */
  depth: number;
}

export interface ParallaxMove {
  /** How far the nearest layer moves, project px (the camera goes the other way). */
  x: number;
  y: number;
  /** How much the nearest layer grows (0.1 = 10%); a push-in when positive. */
  zoom: number;
}

/** How much of the move a layer at `depth` makes. */
export const depthFactor = (depth: number) => 0.2 + 0.8 * Math.min(1, Math.max(0, depth));

export function applyParallax(p: Project, layers: ParallaxLayer[], move: ParallaxMove, range?: { from: number; to: number }, ease: Easing = 'easeInOut'): { project: Project; clipIds: string[]; problem?: string } {
  const clips = layers.map((l) => ({ l, c: getClip(p, l.clipId) })).filter((x): x is { l: ParallaxLayer; c: Clip } => Boolean(x.c?.visual));
  if (clips.length < 1) return { project: p, clipIds: [], problem: 'no layer with a picture' };
  const from = range?.from ?? Math.max(...clips.map((x) => x.c.start));
  const to = range?.to ?? Math.min(...clips.map((x) => clipEnd(x.c)));
  if (to - from < 0.1) return { project: p, clipIds: [], problem: `the layers are not on screen together long enough (${from.toFixed(2)}–${to.toFixed(2)} s)` };
  let project = p;
  for (const { l, c } of clips) {
    const k = depthFactor(l.depth);
    const a = Math.max(0, from - c.start);
    const b = Math.min(c.duration, to - c.start);
    const v0 = animatedVisual(c, a);
    const key = (t: number, v: number, e: Easing): Keyframe => ({ t: +t.toFixed(4), v: +v.toFixed(4), ease: e });
    const keys = {
      ...(c.keys ?? {}),
      x: [key(a, v0.x, ease), key(b, v0.x + move.x * k, 'linear')],
      y: [key(a, v0.y, ease), key(b, v0.y + move.y * k, 'linear')],
      scale: [key(a, v0.scale, ease), key(b, v0.scale * (1 + move.zoom * k), 'linear')],
    };
    project = updateClip(project, c.id, (x) => ({ ...x, keys }));
  }
  return { project, clipIds: clips.map((x) => x.c.id) };
}
