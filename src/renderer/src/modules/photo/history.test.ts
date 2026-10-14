import { describe, expect, it } from 'vitest';
import { DocHistory } from './history';
import { constrainRect, dabSpacing, snapAngle, spacedDabs, Smoother } from './tools/brushMath';
import { copyName, docMemory, insertLayer, makeRasterLayer, moveLayerTo, nextLayerName, removeLayer, setActiveLayer, updateLayer, emptyDoc, cloneLayer } from './doc';

interface S {
  name: string;
  blobs: { size: number }[];
}

const estimate = (s: S): Iterable<[object, number]> => s.blobs.map((b) => [b, b.size] as [object, number]);

describe('DocHistory', () => {
  it('records steps, undoes and redoes', () => {
    const h = new DocHistory<S>({ name: 'a', blobs: [] }, 'Open', { maxSteps: 10, maxBytes: Infinity });
    h.set({ name: 'b', blobs: [] }, { label: 'B' });
    h.set({ name: 'c', blobs: [] }, { label: 'C' });
    expect(h.rows().map((r) => r.label)).toEqual(['Open', 'B', 'C']);
    h.undo();
    expect(h.present.name).toBe('b');
    expect(h.rows().map((r) => [r.label, r.future])).toEqual([
      ['Open', false],
      ['B', false],
      ['C', true],
    ]);
    h.redo();
    expect(h.present.name).toBe('c');
    h.jumpTo(0);
    expect(h.present.name).toBe('a');
    h.jumpTo(2);
    expect(h.present.name).toBe('c');
  });
  it('live edits become one step on commit and can be discarded', () => {
    const h = new DocHistory<S>({ name: 'a', blobs: [] }, 'Open', { maxSteps: 10, maxBytes: Infinity });
    h.set({ name: 'a1', blobs: [] }, { record: false });
    h.set({ name: 'a2', blobs: [] }, { record: false });
    expect(h.past.length).toBe(0);
    h.commit('Drag');
    expect(h.past.length).toBe(1);
    h.undo();
    expect(h.present.name).toBe('a');
    h.set({ name: 'x', blobs: [] }, { record: false });
    h.discardLive();
    expect(h.present.name).toBe('a');
  });
  it('drops the oldest steps when over the step limit', () => {
    const h = new DocHistory<S>({ name: '0', blobs: [] }, 'Open', { maxSteps: 3, maxBytes: Infinity });
    for (let i = 1; i <= 5; i++) h.set({ name: String(i), blobs: [] }, { label: `S${i}` });
    expect(h.past.length).toBe(3);
    expect(h.rows().map((r) => r.label)).toEqual(['S2', 'S3', 'S4', 'S5']);
  });
  it('enforces the memory budget counting shared buffers once', () => {
    const shared = { size: 100 };
    const h = new DocHistory<S>({ name: '0', blobs: [shared] }, 'Open', { maxSteps: 100, maxBytes: 350, estimate });
    for (let i = 1; i <= 5; i++) h.set({ name: String(i), blobs: [shared, { size: 100 }] }, { label: `S${i}` });
    expect(h.memoryBytes()).toBeLessThanOrEqual(350);
    expect(h.past.length).toBeGreaterThanOrEqual(1);
    expect(h.present.name).toBe('5');
  });
  it('notifies subscribers', () => {
    const h = new DocHistory<S>({ name: '0', blobs: [] }, 'Open', { maxSteps: 3, maxBytes: Infinity });
    let calls = 0;
    const off = h.subscribe(() => calls++);
    h.set({ name: '1', blobs: [] });
    off();
    h.set({ name: '2', blobs: [] });
    expect(calls).toBe(1);
  });
});

describe('brush math', () => {
  it('spaces dabs evenly across segments', () => {
    const a = spacedDabs({ x: 0, y: 0 }, { x: 10, y: 0 }, 4, 0);
    expect(a.dabs.map((d) => d.x)).toEqual([4, 8]);
    expect(a.carry).toBeCloseTo(2);
    const b = spacedDabs({ x: 10, y: 0 }, { x: 20, y: 0 }, 4, a.carry);
    expect(b.dabs.map((d) => d.x)).toEqual([12, 16, 20]);
  });
  it('smoother lags behind but converges', () => {
    const s = new Smoother(0.5);
    s.push({ x: 0, y: 0 });
    const p = s.push({ x: 10, y: 0 });
    expect(p.x).toBeGreaterThan(0);
    expect(p.x).toBeLessThan(10);
    let q = p;
    for (let i = 0; i < 50; i++) q = s.push({ x: 10, y: 0 });
    expect(q.x).toBeCloseTo(10, 1);
  });
  it('spacing, angle snap and aspect constraint', () => {
    expect(dabSpacing(100, 1)).toBe(8);
    const p = snapAngle({ x: 0, y: 0 }, { x: 10, y: 1 });
    expect(p.y).toBeCloseTo(0);
    expect(constrainRect({ x: 0, y: 0 }, { x: 10, y: 4 }, 1)).toEqual({ x: 10, y: 10 });
    expect(constrainRect({ x: 0, y: 0 }, { x: -8, y: 2 }, 2)).toEqual({ x: -8, y: 4 });
  });
});

describe('document helpers', () => {
  const fakeCanvas = (w: number, h: number) => ({ width: w, height: h }) as unknown as HTMLCanvasElement;
  it('inserts above the active layer, reorders and removes', () => {
    const a = makeRasterLayer('A', fakeCanvas(100, 100));
    const b = makeRasterLayer('B', fakeCanvas(10, 10));
    const c = makeRasterLayer('C', fakeCanvas(10, 10));
    let doc = insertLayer(insertLayer(insertLayer(emptyDoc(100, 100), a), b), c);
    expect(doc.layers.map((l) => l.name)).toEqual(['A', 'B', 'C']);
    expect(doc.activeId).toBe(c.id);
    doc = moveLayerTo(doc, c.id, 0);
    expect(doc.layers.map((l) => l.name)).toEqual(['C', 'A', 'B']);
    doc = setActiveLayer(doc, a.id);
    const d = makeRasterLayer('D', fakeCanvas(1, 1));
    doc = insertLayer(doc, d);
    expect(doc.layers.map((l) => l.name)).toEqual(['C', 'A', 'D', 'B']);
    expect(doc.activeId).toBe(d.id);
    doc = removeLayer(doc, d.id);
    expect(doc.activeId).toBe(b.id);
    doc = removeLayer(doc, b.id);
    expect(doc.activeId).toBe(a.id);
    expect(doc.layers.length).toBe(2);
  });
  it('updates layers immutably', () => {
    const a = makeRasterLayer('A', fakeCanvas(1, 1));
    const doc = insertLayer(emptyDoc(1, 1), a);
    const next = updateLayer(doc, a.id, { opacity: 0.5 });
    expect(next).not.toBe(doc);
    expect(doc.layers[0].opacity).toBe(1);
    expect(next.layers[0].opacity).toBe(0.5);
    expect(updateLayer(doc, 'missing', { opacity: 0.2 })).toBe(doc);
  });
  it('names layers and copies', () => {
    const doc = insertLayer(insertLayer(emptyDoc(1, 1), makeRasterLayer('Layer 1', fakeCanvas(1, 1))), makeRasterLayer('Layer 4', fakeCanvas(1, 1)));
    expect(nextLayerName(doc)).toBe('Layer 5');
    expect(copyName('Sky')).toBe('Sky copy');
    expect(copyName('Sky copy')).toBe('Sky copy 2');
    expect(copyName('Sky copy 2')).toBe('Sky copy 3');
    const clone = cloneLayer(doc.layers[0]);
    expect(clone.id).not.toBe(doc.layers[0].id);
  });
  it('counts memory per unique canvas', () => {
    const shared = fakeCanvas(10, 10);
    const doc = insertLayer(insertLayer(emptyDoc(10, 10), makeRasterLayer('A', shared)), makeRasterLayer('B', fakeCanvas(2, 2)));
    const entries = [...docMemory(doc)];
    expect(entries.map((e) => e[1])).toEqual([400, 16]);
  });
});
