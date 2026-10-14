import { describe, expect, it } from 'vitest';
import { applyAIActions, coerceValue, normalizePropKey, sceneToActions, summarizeAIResult, type AIApplyContext } from './ai-actions';
import { describeDocument, suggestPrompt } from './ai-prompts';
import { evaluateProp } from './keyframes';
import { createDoc, createLayer } from './model';
import type { MotionDoc } from './types';

const ctx: AIApplyContext = {
  time: 0,
  bounds: (_doc, layer) => {
    const p = layer.props.position.value;
    return { x: p[0] - 50, y: p[1] - 50, w: 100, h: 100 };
  },
};

function docWithLayer(): MotionDoc {
  const doc = createDoc();
  const layer = createLayer('text', doc.comp, { text: 'Hello' });
  layer.id = 'L1';
  return { ...doc, layers: [layer] };
}

describe('applyAIActions', () => {
  it('sets the composition with clamping', () => {
    const r = applyAIActions(createDoc(), [{ type: 'setComposition', width: 99999, height: 1080, fps: 0, duration: 8, background: 'transparent' }], ctx);
    expect(r.doc.comp.width).toBe(8192);
    expect(r.doc.comp.fps).toBe(1);
    expect(r.doc.comp.duration).toBe(8);
    expect(r.doc.comp.transparent).toBe(true);
    expect(r.compositionChanged).toBe(true);
  });

  it('adds layers with AI ids that later actions can reference', () => {
    const r = applyAIActions(
      createDoc(),
      [
        { type: 'addLayer', id: 'title', layerType: 'text', props: { text: 'SUMMER SALE', fontSize: 140, fontWeight: 'bold', fill: '#ffcc00', x: 960, y: 400 } },
        { type: 'addLayer', id: 'dot', layerType: 'circle', props: { width: 80, height: 80, color: 'red' } },
        { type: 'addKeyframes', layerId: 'title', property: 'position', keyframes: [{ time: 0, value: [960, -100], easing: 'bounce' }, { time: 1, value: [960, 400] }] },
        { type: 'applyPreset', layerId: 'dot', preset: 'pop-in', time: 0.5, duration: 0.5 },
      ],
      ctx,
    );
    expect(r.created).toHaveLength(2);
    const title = r.doc.layers.find((l) => l.text?.text === 'SUMMER SALE')!;
    expect(title.text?.fontWeight).toBe(700);
    expect(title.props.fill.value).toBe('#ffcc00');
    expect(title.props.position.keyframes).toHaveLength(2);
    expect(title.props.position.keyframes[0].easing).toBe('bounce');
    const dot = r.doc.layers.find((l) => l.shape?.kind === 'ellipse')!;
    expect(dot.props.fill.value).toBe('#ff0000');
    expect(evaluateProp(dot.props.scale, 0.5)).toEqual([0, 0]);
    expect(r.keyframes).toBe(2);
    expect(r.presets).toBe(1);
    // The later layer is on top.
    expect(r.doc.layers[0]).toBe(dot);
    expect(summarizeAIResult(r)).toContain('2 layer(s) added');
  });

  it('validates and clamps every field', () => {
    const r = applyAIActions(
      docWithLayer(),
      [
        { type: 'setProps', layerId: 'L1', props: { opacity: 0.5, rotation: 'abc', fontSize: -5, blendMode: 'evil', scale: 50, fill: 'not-a-color' } },
        { type: 'addKeyframes', layerId: 'L1', property: 'rotation', keyframes: [{ time: 999, value: 10 }, { time: 'x', value: 5 }, { time: 1, value: 'nope' }] },
      ],
      ctx,
    );
    const l = r.doc.layers[0];
    expect(l.props.opacity.value).toBe(50); // 0..1 fraction → %
    expect(l.props.rotation.value).toBe(0);
    expect(l.text?.fontSize).toBe(4);
    expect(l.blendMode).toBe('normal');
    expect(l.props.scale.value).toEqual([50, 50]);
    expect(l.props.fill.value).toBe('#ffffff');
    // time clamped to the duration, invalid ones dropped
    expect(l.props.rotation.keyframes.map((k) => k.time)).toEqual([5]);
  });

  it('ignores unknown action types and unknown layers', () => {
    const doc = docWithLayer();
    const r = applyAIActions(doc, [{ type: 'explode' }, { type: 'setProps', layerId: 'nope', props: { opacity: 1 } }, null, 'x'] as unknown[], ctx);
    expect(r.doc).toBe(doc);
    expect(summarizeAIResult(r)).toBe('Nothing to change');
  });

  it('finds layers by name as a fallback, deletes and sets easing', () => {
    let r = applyAIActions(docWithLayer(), [{ type: 'addKeyframes', layerId: 'hello', property: 'opacity', keyframes: [{ time: 0, value: 0 }, { time: 1, value: 100 }] }], ctx);
    expect(r.doc.layers[0].props.opacity.keyframes).toHaveLength(2);
    r = applyAIActions(r.doc, [{ type: 'setEasing', layerId: 'L1', property: 'all', easing: 'cubic-bezier(0.2,0.8,0.2,1)' }], ctx);
    expect(r.doc.layers[0].props.opacity.keyframes[0]).toMatchObject({ easing: 'bezier', bezier: [0.2, 0.8, 0.2, 1] });
    r = applyAIActions(r.doc, [{ type: 'clearKeyframes', layerId: 'L1', property: 'opacity' }], { ...ctx, time: 1 });
    expect(r.doc.layers[0].props.opacity.keyframes).toHaveLength(0);
    expect(r.doc.layers[0].props.opacity.value).toBe(100);
    r = applyAIActions(r.doc, [{ type: 'deleteLayer', layerId: 'L1' }], ctx);
    expect(r.doc.layers).toHaveLength(0);
    expect(r.deleted).toBe(1);
  });

  it('parses SVG paths for path layers and centers them', () => {
    const r = applyAIActions(createDoc(), [{ type: 'addLayer', layerType: 'path', props: { path: 'M100 100 L300 100 L300 200 Z', stroke: '#fff', strokeWidth: 4 } }], ctx);
    const l = r.doc.layers[0];
    expect(l.shape?.kind).toBe('path');
    expect(l.props.position.value).toEqual([200, 150]);
    expect(l.shape?.strokeEnabled).toBe(true);
    expect(l.shape?.path?.[0].nodes[0]).toMatchObject({ x: -100, y: -50 });
  });

  it('refuses parent cycles', () => {
    const r = applyAIActions(
      createDoc(),
      [
        { type: 'addLayer', id: 'a', layerType: 'null' },
        { type: 'addLayer', id: 'b', layerType: 'rect', props: { parentId: 'a' } },
        { type: 'setProps', layerId: 'a', props: { parentId: 'b' } },
      ],
      ctx,
    );
    const a = r.doc.layers.find((l) => l.type === 'null')!;
    const b = r.doc.layers.find((l) => l.type === 'shape')!;
    expect(b.parentId).toBe(a.id);
    expect(a.parentId).toBeNull();
  });

  it('reports preset problems as notes', () => {
    const r = applyAIActions(docWithLayer(), [{ type: 'applyPreset', layerId: 'L1', preset: 'drawOn' }, { type: 'applyPreset', layerId: 'L1', preset: 'teleport' }], ctx);
    expect(r.notes.length).toBe(2);
  });
});

describe('helpers', () => {
  it('normalizes property names and values', () => {
    expect(normalizePropKey('Anchor Point')).toBe('anchor');
    expect(normalizePropKey('tracking')).toBe('letterSpacing');
    expect(normalizePropKey('color')).toBe('fill');
    expect(normalizePropKey('wobble')).toBeNull();
    expect(coerceValue('position', { x: 1, y: 2 })).toEqual([1, 2]);
    expect(coerceValue('scale', 120)).toEqual([120, 120]);
    expect(coerceValue('position', 5)).toBeNull();
    expect(coerceValue('opacity', 250)).toBe(100);
    expect(coerceValue('fill', 'rgb(0,0,255)')).toBe('#0000ff');
  });

  it('turns a scene into actions (layers first, then animation)', () => {
    const actions = sceneToActions({
      composition: { width: 1080, height: 1920 },
      layers: [
        { id: 'bg', layerType: 'solid', props: { fill: '#000' } },
        { id: 'title', layerType: 'text', props: { text: 'Hi' }, keyframes: { opacity: [{ time: 0, value: 0 }, { time: 1, value: 100 }] }, presets: [{ preset: 'popIn', time: 0 }] },
      ],
    });
    expect(actions.map((a) => a.type)).toEqual(['setComposition', 'addLayer', 'addLayer', 'addKeyframes', 'applyPreset']);
    const r = applyAIActions(createDoc(), actions, ctx);
    expect(r.doc.comp.height).toBe(1920);
    expect(r.doc.layers[0].text?.text).toBe('Hi');
    expect(r.doc.layers[1].type).toBe('solid');
    expect(sceneToActions('nope')).toEqual([]);
  });

  it('describes the document for the AI', () => {
    const doc = docWithLayer();
    const text = describeDocument(doc, 1.5, ['L1']);
    expect(text).toContain('1920×1080');
    expect(text).toContain('id=L1');
    expect(text).toContain('Current time: 1.5s');
    expect(suggestPrompt(doc, doc.layers[0])).toContain('no keyframes');
  });
});
