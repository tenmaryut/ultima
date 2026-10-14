import { describe, expect, it } from 'vitest';
import { gifDelays, indexFrame, nearestLookup, samplePixels } from './gif';
import { evaluateProp, setKeyframe } from './keyframes';
import { apply } from './matrix';
import { createDoc, createLayer, setParent } from './model';
import { copyKeys, deleteKeys, insertLayers, moveKeys, pasteKeys, setKeysEasing, toggleKeyAt, trimToWorkArea } from './ops';
import { applyAnchor, applyMove, moveItems, rotationFor, scaleFor, snapMove, startAnchor, startRotate, startScale, worldMatrixAt } from './stage-drag';
import { buildKeyIndex } from './state';
import type { MotionDoc } from './types';

function docWithAnimatedLayer(): MotionDoc {
  const doc = createDoc({ duration: 4 });
  const layer = createLayer('shape', doc.comp);
  layer.props.opacity = setKeyframe(setKeyframe(layer.props.opacity, 1, 0, { easing: 'linear' }), 2, 100);
  return { ...doc, layers: [layer] };
}

describe('keyframe operations', () => {
  it('moves keys across layers with one call and keeps them in range', () => {
    const doc = docWithAnimatedLayer();
    const ids = doc.layers[0].props.opacity.keyframes.map((k) => k.id);
    const moved = moveKeys(doc, ids, buildKeyIndex(doc), 0.5);
    expect(moved.layers[0].props.opacity.keyframes.map((k) => k.time)).toEqual([1.5, 2.5]);
    const clamped = moveKeys(doc, ids, buildKeyIndex(doc), 10);
    expect(clamped.layers[0].props.opacity.keyframes.map((k) => k.time)).toEqual([4]);
  });

  it('copies and pastes keys at the playhead (relative timing kept)', () => {
    const doc = docWithAnimatedLayer();
    const other = createLayer('text', doc.comp);
    const withOther = { ...doc, layers: [...doc.layers, other] };
    const ids = doc.layers[0].props.opacity.keyframes.map((k) => k.id);
    const copied = copyKeys(withOther, ids, buildKeyIndex(withOther));
    const r = pasteKeys(withOther, copied, [other.id], 3);
    expect(r.count).toBe(2);
    const pasted = r.doc.layers[1].props.opacity.keyframes;
    expect(pasted.map((k) => k.time)).toEqual([3, 4]);
    expect(evaluateProp(r.doc.layers[1].props.opacity, 3.5)).toBeCloseTo(50);
  });

  it('refuses to paste values of the wrong kind', () => {
    const doc = docWithAnimatedLayer();
    const copied = copyKeys(doc, doc.layers[0].props.opacity.keyframes.map((k) => k.id), buildKeyIndex(doc)).map((k) => ({ ...k, prop: 'position' as const }));
    expect(pasteKeys(doc, copied, [doc.layers[0].id], 0).count).toBe(0);
  });

  it('deletes keys, sets easing and toggles keys at the playhead', () => {
    let doc = docWithAnimatedLayer();
    const [k1] = doc.layers[0].props.opacity.keyframes;
    doc = setKeysEasing(doc, [k1.id], buildKeyIndex(doc), 'bounce');
    expect(doc.layers[0].props.opacity.keyframes[0].easing).toBe('bounce');
    doc = toggleKeyAt(doc, doc.layers[0].id, 'opacity', 1.5);
    expect(doc.layers[0].props.opacity.keyframes).toHaveLength(3);
    doc = toggleKeyAt(doc, doc.layers[0].id, 'opacity', 1.5);
    expect(doc.layers[0].props.opacity.keyframes).toHaveLength(2);
    doc = deleteKeys(doc, [k1.id], buildKeyIndex(doc), 0);
    expect(doc.layers[0].props.opacity.keyframes).toHaveLength(1);
  });

  it('trims the composition to the work area and keeps values at the new start', () => {
    const doc = docWithAnimatedLayer();
    const trimmed = trimToWorkArea({ ...doc, comp: { ...doc.comp, workStart: 1.5, workEnd: 3 } });
    expect(trimmed.comp.duration).toBe(1.5);
    const opacity = trimmed.layers[0].props.opacity;
    expect(evaluateProp(opacity, 0)).toBeCloseTo(50);
    expect(evaluateProp(opacity, 0.5)).toBeCloseTo(100);
  });

  it('inserts new layers above the selection', () => {
    const doc = docWithAnimatedLayer();
    const a = createLayer('solid', doc.comp);
    const b = createLayer('null', doc.comp);
    const d1 = insertLayers({ ...doc, layers: [a, ...doc.layers] }, [b], [doc.layers[0].id]);
    expect(d1.layers.map((l) => l.id)).toEqual([a.id, b.id, doc.layers[0].id]);
  });
});

describe('stage manipulation', () => {
  it('moves parented layers in their parent space', () => {
    let doc = createDoc();
    const parent = createLayer('null', doc.comp, { position: [500, 500] });
    parent.props.scale.value = [200, 200];
    const child = createLayer('shape', doc.comp, { position: [600, 500] });
    doc = { ...doc, layers: [child, parent] };
    doc = setParent(doc, child.id, parent.id, 0);
    const items = moveItems(doc, [child.id], 0);
    const moved = applyMove(doc, items, 100, 0, 0);
    const world = apply(worldMatrixAt(moved, moved.layers[0], 0), 0, 0);
    expect(world[0]).toBeCloseTo(700);
    expect(world[1]).toBeCloseTo(500);
  });

  it('scales from a corner handle around the anchor point', () => {
    const doc = createDoc();
    const layer = createLayer('shape', doc.comp, { size: [100, 100], position: [500, 500] });
    // se corner at content (50, 50); dragging it to (600, 550) doubles x and keeps y
    const d = startScale({ ...doc, layers: [layer] }, layer, 'se', 50, 50, 0);
    expect(scaleFor(d, 600, 550, false)).toEqual([200, 100]);
    const uniform = scaleFor(d, 600, 600, true);
    expect(uniform[0]).toBeCloseTo(200);
    expect(uniform[1]).toBeCloseTo(200);
    // edge handle only changes one axis
    const e = startScale({ ...doc, layers: [layer] }, layer, 'e', 50, 0, 0);
    expect(scaleFor(e, 525, 900, false)).toEqual([50, 100]);
  });

  it('rotates around the anchor with 15° snapping', () => {
    const doc = createDoc();
    const layer = createLayer('shape', doc.comp, { position: [0, 0] });
    const d = startRotate(layer, worldMatrixAt({ ...doc, layers: [layer] }, layer, 0), 100, 0, 0);
    expect(rotationFor(d, 0, 100, false)).toBeCloseTo(90);
    expect(rotationFor(d, 100, 20, true)).toBe(15);
  });

  it('moving the anchor point keeps the layer in place', () => {
    const doc = createDoc();
    const layer = createLayer('shape', doc.comp, { position: [400, 300] });
    layer.props.rotation.value = 30;
    layer.props.scale.value = [150, 80];
    const d0 = { ...doc, layers: [layer] };
    const before = worldMatrixAt(d0, layer, 0);
    const corner = apply(before, 50, 50);
    const target = apply(before, 20, -10);
    const next = applyAnchor(d0, startAnchor(layer, before, 0), target[0], target[1], 0);
    expect(next.layers[0].props.anchor.value[0]).toBeCloseTo(20);
    expect(next.layers[0].props.anchor.value[1]).toBeCloseTo(-10);
    const after = apply(worldMatrixAt(next, next.layers[0], 0), 50, 50);
    expect(after[0]).toBeCloseTo(corner[0]);
    expect(after[1]).toBeCloseTo(corner[1]);
  });

  it('snaps a moving box to the composition center and edges', () => {
    const r = snapMove({ x: 100, y: 100, w: 200, h: 100 }, 657, 0, 1920, 1080, 6);
    expect(r.dx).toBe(660); // box center 200+657 → 960
    expect(r.guides).toEqual([{ x: 960 }]);
    expect(snapMove({ x: 100, y: 100, w: 200, h: 100 }, 300, 0, 1920, 1080, 6).guides).toEqual([]);
  });
});

describe('gif helpers', () => {
  it('spreads delays so the total time matches the frame rate', () => {
    const d = gifDelays(30, 30);
    expect(d.reduce((a, b) => a + b, 0)).toBe(1000);
    expect(d.every((x) => x % 10 === 0)).toBe(true);
    expect(gifDelays(3, 25)).toEqual([40, 40, 40]);
  });

  it('samples opaque pixels only and maps to the nearest palette color', () => {
    const frame = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 255]);
    const s = samplePixels([frame]);
    expect(Array.from(s)).toEqual([255, 0, 0, 255, 0, 255, 0, 255]);
    const palette = [
      [0, 0, 0],
      [250, 10, 10],
      [10, 250, 10],
    ];
    const lookup = nearestLookup(palette);
    expect(lookup(240, 20, 0)).toBe(1);
    const idx = indexFrame(frame, 3, 1, [...palette, [0, 0, 0]], { dither: false, transparentIndex: 3 });
    expect(Array.from(idx)).toEqual([1, 3, 2]);
  });

  it('dithering keeps the average color of a flat area', () => {
    const w = 16;
    const h = 16;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) rgba.set([128, 128, 128, 255], i * 4);
    const palette = [
      [0, 0, 0],
      [255, 255, 255],
    ];
    const idx = indexFrame(rgba, w, h, palette, { dither: true });
    const whites = Array.from(idx).filter((v) => v === 1).length;
    expect(whites / (w * h)).toBeGreaterThan(0.4);
    expect(whites / (w * h)).toBeLessThan(0.6);
  });
});
