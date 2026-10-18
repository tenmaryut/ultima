import { describe, expect, it } from 'vitest';
import { applyHomography, clipHomography, has3D, invert3, pivotOf, planeHomography, projectPoint, warpPixels, type Mat3, type Plane3D } from './warp3d';
import { applyParallax, depthFactor } from './parallax';
import { applyAIActions } from './ai/executor';
import { describeProject } from './ai/describe';
import { addMediaToTimeline, createProject, getClip } from './model';
import { parseProject, serializeProject } from './project';
import { valueAt } from './keyframes';
import { DEFAULT_VISUAL } from './presets';
import type { MediaRef, Project } from './types';

const plane = (o: Partial<Plane3D>): Plane3D => ({ rotateX: 0, rotateY: 0, z: 0, focal: 1620, pivot: { x: 960, y: 540 }, W: 1920, H: 1080, ...o });

describe('3D planes', () => {
  it('leaves a flat plane where it is', () => {
    expect(projectPoint(plane({}), 100, 900)).toEqual({ x: 100, y: 900 });
    expect(has3D(DEFAULT_VISUAL)).toBe(false);
  });

  it('turns the right side away and the left side closer', () => {
    const p = plane({ rotateY: 30 });
    const right = projectPoint(p, 1460, 540)!;
    const left = projectPoint(p, 460, 540)!;
    // the far side is smaller, the near side bigger
    expect(1460 - 960).toBeGreaterThan(right.x - 960);
    expect(960 - 460).toBeLessThan(960 - left.x);
    // a vertical edge on the far side gets shorter than the same edge on the near side
    const farH = projectPoint(p, 1460, 740)!.y - projectPoint(p, 1460, 340)!.y;
    const nearH = projectPoint(p, 460, 740)!.y - projectPoint(p, 460, 340)!.y;
    expect(farH).toBeLessThan(nearH);
    // the axis it turns around stays put
    expect(projectPoint(p, 960, 300)!.x).toBeCloseTo(960, 6);
  });

  it('tilts the top away, pushes the picture away with depth, and hides what is behind the camera', () => {
    const tilt = plane({ rotateX: 40 });
    const top = projectPoint(tilt, 1460, 140)!.x - projectPoint(tilt, 460, 140)!.x;
    const bottom = projectPoint(tilt, 1460, 940)!.x - projectPoint(tilt, 460, 940)!.x;
    expect(top).toBeLessThan(1000);
    expect(bottom).toBeGreaterThan(1000);
    const far = projectPoint(plane({ z: 1620 }), 1920, 540)!;
    expect(far.x).toBeCloseTo(960 + 960 / 2, 6);
    expect(projectPoint(plane({ z: -1620 }), 0, 0)).toBeNull();
  });

  it('is a homography: four points decide every other one', () => {
    const p = plane({ rotateX: -25, rotateY: 35, z: 300, pivot: { x: 700, y: 400 } });
    const m = planeHomography(p)!;
    for (const [x, y] of [[0, 0], [1920, 1080], [333, 777], [1500, 120]]) {
      const want = projectPoint(p, x, y)!;
      const got = applyHomography(m, x, y)!;
      expect(got.x).toBeCloseTo(want.x, 3);
      expect(got.y).toBeCloseTo(want.y, 3);
    }
    const inv = invert3(m)!;
    const back = applyHomography(inv, ...(Object.values(applyHomography(m, 321, 654)!) as [number, number]))!;
    expect(back.x).toBeCloseTo(321, 6);
    expect(back.y).toBeCloseTo(654, 6);
  });

  it('warps pixels through the homography (the CPU path)', () => {
    const w = 64;
    const h = 36;
    const src = new Uint8ClampedArray(w * h * 4);
    // a white square in the middle of a transparent frame
    for (let y = 12; y < 24; y++) for (let x = 26; x < 38; x++) src.set([255, 255, 255, 255], (y * w + x) * 4);
    const same = new Uint8ClampedArray(src.length);
    const identity: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    warpPixels(src, same, w, h, identity, 1);
    expect([...same]).toEqual([...src]);
    // pushed away to twice the distance: half the size around the frame centre
    const m = planeHomography({ rotateX: 0, rotateY: 0, z: 54, focal: 54, pivot: { x: 32, y: 18 }, W: 64, H: 36 })!;
    const far = new Uint8ClampedArray(src.length);
    warpPixels(src, far, w, h, invert3(m)!, 1);
    let lit = 0;
    for (let i = 3; i < far.length; i += 4) lit += far[i] > 128 ? 1 : 0;
    expect(lit).toBeGreaterThan(25);
    expect(lit).toBeLessThan(50);
  });
});

const photo: MediaRef = { id: 'm_photo', name: 'city.jpg', kind: 'image', duration: 0, width: 1920, height: 1080, size: 1, mime: 'image/jpeg', hasAudio: false };

function project(): { p: Project; bg: string; fg: string } {
  let p: Project = { ...createProject(), media: [photo] };
  p = { ...p, settings: { ...p.settings, width: 1920, height: 1080 } };
  const a = addMediaToTimeline(p, photo, { start: 0, duration: 4 });
  const r = applyAIActions(a.project, [{ type: 'addTitle', text: 'CLUTCH', start: 0, duration: 4, style: { extrude: 24, extrudeColor: '#552200' } }], { playhead: 0 });
  return { p: r.project, bg: a.ids[0], fg: r.project.clips.find((c) => c.kind === 'title')!.id };
}

describe('3D for clips, titles and the AI', () => {
  it('turns titles around their anchor, pictures around their centre', () => {
    const { p, bg, fg } = project();
    const t = getClip(p, fg)!;
    expect(pivotOf(p, t, { ...t.visual!, y: 100 })).toEqual({ x: 960, y: 640 });
    expect(clipHomography(p, getClip(p, bg)!, DEFAULT_VISUAL)).toBeNull();
    expect(clipHomography(p, getClip(p, bg)!, { ...DEFAULT_VISUAL, rotateY: 20 })).not.toBeNull();
  });

  it('sets 3D from the AI, keeps it in the project and describes it', () => {
    const { p, bg, fg } = project();
    const r = applyAIActions(p, [{ type: 'setClip', clipId: bg, props: { rotateX: 15, rotateY: -30, z: 200, perspective: 0.8 } }], { playhead: 0 });
    expect(r.results[0].detail).toContain('rotateX, rotateY, z, perspective');
    const v = getClip(r.project, bg)!.visual!;
    expect([v.rotateX, v.rotateY, v.z, v.perspective]).toEqual([15, -30, 200, 0.8]);
    const back = parseProject(serializeProject(r.project));
    expect(getClip(back, bg)!.visual).toEqual(v);
    expect(getClip(back, fg)!.title).toMatchObject({ extrude: 24, extrudeColor: '#552200' });
    const text = describeProject(r.project, { playhead: 0, selection: [] });
    expect(text).toContain('3D tilt 15° turn -30° depth 200 px perspective 0.8');
    expect(text).toContain('3D letters 24px #552200');
    // animated like any property
    const k = applyAIActions(r.project, [{ type: 'keyframes', clipId: bg, prop: 'rotateY', keys: [{ t: 0, v: -30 }, { t: 2, v: 30 }] }], { playhead: 0 });
    expect(valueAt(getClip(k.project, bg)!, 'rotateY', 1)).toBeCloseTo(0, 6);
  });

  it('moves near layers more than far ones', () => {
    const { p, bg, fg } = project();
    expect(depthFactor(0)).toBe(0.2);
    expect(depthFactor(1)).toBe(1);
    const r = applyParallax(p, [{ clipId: bg, depth: 0 }, { clipId: fg, depth: 1 }], { x: -200, y: 0, zoom: 0.1 });
    const at = (id: string, t: number) => ({ x: valueAt(getClip(r.project, id)!, 'x', t), s: valueAt(getClip(r.project, id)!, 'scale', t) });
    expect(at(bg, 4)).toEqual({ x: -40, s: 1.02 });
    expect(at(fg, 4)).toEqual({ x: -200, s: 1.1 });
    expect(at(fg, 0)).toEqual({ x: 0, s: 1 });
    const ai = applyAIActions(p, [{ type: 'parallax', layers: [{ clipId: bg, depth: 0 }, { clipId: fg, depth: 1 }], move: { x: -200, zoom: 0.1 } }], { playhead: 0 });
    expect(ai.results[0].detail).toContain(`${bg} (depth 0) moves 20%, ${fg} (depth 1) moves 100%`);
    expect(applyAIActions(p, [{ type: 'parallax', layers: [{ clipId: bg }], move: {} }], { playhead: 0 }).results[0].detail).toContain('"move" needs');
  });
});
