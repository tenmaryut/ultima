import { describe, expect, it } from 'vitest';
import { evaluateDoc, renderOrder } from './evaluate';
import { setKeyframe } from './keyframes';
import { apply } from './matrix';
import {
  createDoc,
  createLayer,
  duplicateLayers,
  isAncestor,
  removeLayers,
  reorderLayers,
  setDuration,
  setParent,
  shiftLayer,
} from './model';
import { parseProject, serializeProject } from './project';
import type { MotionDoc } from './types';

function sampleDoc(): MotionDoc {
  const doc = createDoc({ name: 'Test', duration: 4 });
  const text = createLayer('text', doc.comp, { text: 'Hi' });
  text.props.opacity = setKeyframe(setKeyframe(text.props.opacity, 0, 0, { easing: 'bezier', bezier: [0.1, 0.2, 0.3, 1] }), 1, 100);
  const shape = createLayer('shape', doc.comp, { shapeKind: 'star' });
  const image = createLayer('image', doc.comp, { assetId: 'img1' });
  return {
    ...doc,
    layers: [text, shape, image],
    assets: { img1: { id: 'img1', kind: 'image', name: 'a.png', mime: 'image/png', width: 10, height: 20, blob: null as unknown as Blob, url: '' } },
  };
}

describe('project files', () => {
  it('round-trips a document', () => {
    const doc = sampleDoc();
    const json = serializeProject(doc, { img1: 'data:image/png;base64,AAAA' });
    expect(json.startsWith('{"app":"ultima","module":"motion","version":1')).toBe(true);
    const parsed = parseProject(json);
    expect(parsed.comp).toEqual(doc.comp);
    expect(parsed.layers).toEqual(doc.layers);
    expect(parsed.assets).toEqual([{ id: 'img1', kind: 'image', name: 'a.png', mime: 'image/png', width: 10, height: 20, data: 'data:image/png;base64,AAAA' }]);
  });

  it('rejects foreign files with readable errors', () => {
    expect(() => parseProject('not json')).toThrow(/invalid JSON/);
    expect(() => parseProject('{"app":"other"}')).toThrow(/not an Ultima project/);
    expect(() => parseProject('{"app":"ultima","module":"photo"}')).toThrow(/another module/);
    expect(() => parseProject('{"app":"ultima","module":"motion","version":99}')).toThrow(/newer version/);
  });

  it('repairs broken content', () => {
    const json = JSON.stringify({
      app: 'ultima',
      module: 'motion',
      version: 1,
      comp: { width: -5, height: 'x', fps: 1000, duration: 2, background: 'javascript:alert(1)' },
      layers: [
        { id: 'a', type: 'shape', parentId: 'b', props: { opacity: { value: 999, keyframes: [{ time: 1, value: 50, easing: 'nope' }, { time: 'bad' }] } } },
        { id: 'b', type: 'text', parentId: 'a', text: { text: 'x', fontFamily: 'Evil"; }', fontWeight: 1234 } },
        { id: 'a', type: 'solid' },
        { type: 'hacker' },
        { id: 'img', type: 'image', assetId: 'missing' },
      ],
      assets: [{ id: 'x', kind: 'image', data: 'javascript:alert(1)' }],
    });
    const p = parseProject(json);
    expect(p.comp.width).toBe(16);
    expect(p.comp.height).toBe(1080);
    expect(p.comp.fps).toBe(120);
    expect(p.comp.background).toBe('#0f172a');
    expect(p.assets).toHaveLength(0);
    expect(p.layers).toHaveLength(3); // unknown type + image without asset dropped
    const ids = new Set(p.layers.map((l) => l.id));
    expect(ids.size).toBe(3);
    // the parent cycle a ↔ b was broken
    const a = p.layers[0];
    const b = p.layers[1];
    expect(a.parentId === null || b.parentId === null).toBe(true);
    expect(a.props.opacity.value).toBe(100);
    expect(a.props.opacity.keyframes).toHaveLength(1);
    expect(a.props.opacity.keyframes[0].easing).toBe('linear');
    expect(b.text?.fontFamily).toBe('Evil ');
    expect(b.text?.fontWeight).toBe(900);
  });
});

describe('document model', () => {
  it('duplicates layers with fresh ids and keyframe ids', () => {
    const doc = sampleDoc();
    const { doc: next, ids } = duplicateLayers(doc, [doc.layers[0].id]);
    expect(next.layers).toHaveLength(4);
    expect(next.layers[0].id).toBe(ids[0]);
    expect(next.layers[1].id).toBe(doc.layers[0].id);
    expect(next.layers[0].props.opacity.keyframes[0].id).not.toBe(doc.layers[0].props.opacity.keyframes[0].id);
    expect(next.layers[0].name).not.toBe(doc.layers[0].name);
  });

  it('reorders layers', () => {
    const doc = sampleDoc();
    const [a, b, c] = doc.layers.map((l) => l.id);
    expect(reorderLayers(doc, [c], 'top').layers.map((l) => l.id)).toEqual([c, a, b]);
    expect(reorderLayers(doc, [a], 'down').layers.map((l) => l.id)).toEqual([b, a, c]);
    expect(reorderLayers(doc, [a], 'up').layers.map((l) => l.id)).toEqual([a, b, c]);
    expect(reorderLayers(doc, [a], 'bottom').layers.map((l) => l.id)).toEqual([b, c, a]);
  });

  it('removes layers, un-parents children and drops unused assets', () => {
    let doc = sampleDoc();
    doc = setParent(doc, doc.layers[0].id, doc.layers[1].id, 0);
    const next = removeLayers(doc, [doc.layers[1].id, doc.layers[2].id]);
    expect(next.layers).toHaveLength(1);
    expect(next.layers[0].parentId).toBeNull();
    expect(next.assets).toEqual({});
  });

  it('parenting keeps the child in place and children follow the parent', () => {
    let doc = createDoc();
    const parent = createLayer('null', doc.comp, { position: [500, 300] });
    parent.props.rotation.value = 90;
    parent.props.scale.value = [200, 200];
    const child = createLayer('shape', doc.comp, { position: [700, 300] });
    doc = { ...doc, layers: [child, parent] };
    doc = setParent(doc, child.id, parent.id, 0);
    const ev = evaluateDoc(doc, 0);
    const world = ev.get(child.id)!.world;
    const p = apply(world, 0, 0);
    expect(p[0]).toBeCloseTo(700);
    expect(p[1]).toBeCloseTo(300);
    // moving the parent moves the child
    doc = { ...doc, layers: doc.layers.map((l) => (l.id === parent.id ? { ...l, props: { ...l.props, position: { value: [600, 300], keyframes: [] } } } : l)) };
    const moved = apply(evaluateDoc(doc, 0).get(child.id)!.world, 0, 0);
    expect(moved[0]).toBeCloseTo(800);
    expect(isAncestor(doc, child.id, parent.id)).toBe(true);
    // cycles are refused
    expect(setParent(doc, parent.id, child.id, 0)).toBe(doc);
  });

  it('shifts layers in time with their keyframes', () => {
    const doc = sampleDoc();
    const moved = shiftLayer(doc.layers[0], 1);
    expect(moved.inPoint).toBe(1);
    expect(moved.outPoint).toBe(5);
    expect(moved.props.opacity.keyframes.map((k) => k.time)).toEqual([1, 2]);
  });

  it('extends layers when the duration grows', () => {
    const doc = sampleDoc();
    const next = setDuration(doc, 10);
    expect(next.layers.every((l) => l.outPoint === 10)).toBe(true);
    expect(next.comp.workEnd).toBe(10);
    const shorter = setDuration(doc, 2);
    expect(shorter.comp.workEnd).toBe(2);
  });

  it('render order honours solo, visibility and in/out points', () => {
    const doc = sampleDoc();
    const [a, b, c] = doc.layers;
    expect(renderOrder(doc, 1).map((l) => l.id)).toEqual([c.id, b.id, a.id]);
    const solo = { ...doc, layers: [a, { ...b, solo: true }, c] };
    expect(renderOrder(solo, 1).map((l) => l.id)).toEqual([b.id]);
    const hidden = { ...doc, layers: [{ ...a, visible: false }, { ...b, inPoint: 2 }, c] };
    expect(renderOrder(hidden, 1).map((l) => l.id)).toEqual([c.id]);
  });
});
