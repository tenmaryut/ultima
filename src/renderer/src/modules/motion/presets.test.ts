import { describe, expect, it } from 'vitest';
import { evaluateLayer } from './evaluate';
import { evaluateProp } from './keyframes';
import { createLayer, defaultComposition } from './model';
import { applyPreset, normalizePresetId, PRESETS, type PresetContext, type PresetId } from './presets';

const comp = defaultComposition({ width: 1920, height: 1080, duration: 5 });

function ctx(over: Partial<PresetContext> = {}): PresetContext {
  return { time: 1, duration: 1, comp, bounds: { x: 860, y: 440, w: 200, h: 200 }, ...over };
}

describe('presets', () => {
  it('fade in goes from 0 to the current opacity', () => {
    const layer = createLayer('shape', comp);
    const r = applyPreset(layer, 'fadeIn', ctx());
    expect(r.ok).toBe(true);
    const keys = r.layer.props.opacity.keyframes;
    expect(keys.map((k) => [k.time, k.value])).toEqual([
      [1, 0],
      [2, 100],
    ]);
    expect(evaluateProp(r.layer.props.opacity, 0.5)).toBe(0);
    expect(evaluateProp(r.layer.props.opacity, 1.5)).toBeGreaterThan(50); // ease out
  });

  it('fade out ends at 0', () => {
    const r = applyPreset(createLayer('text', comp), 'fadeOut', ctx({ time: 3 }));
    expect(evaluateProp(r.layer.props.opacity, 4)).toBe(0);
    expect(evaluateProp(r.layer.props.opacity, 3)).toBe(100);
  });

  it('slides start completely outside the frame and end at the current position', () => {
    const layer = createLayer('shape', comp);
    const end = layer.props.position.value;
    for (const id of ['slideInLeft', 'slideInRight', 'slideInTop', 'slideInBottom'] as PresetId[]) {
      const r = applyPreset(layer, id, ctx());
      const start = evaluateProp(r.layer.props.position, 1);
      expect(evaluateProp(r.layer.props.position, 2)).toEqual(end);
      const dx = start[0] - end[0];
      const dy = start[1] - end[1];
      // bounds after offset must be outside the composition
      const b = { x: 860 + dx, y: 440 + dy, w: 200, h: 200 };
      const outside = b.x + b.w <= 0 || b.x >= comp.width || b.y + b.h <= 0 || b.y >= comp.height;
      expect(outside, id).toBe(true);
    }
  });

  it('slides use the parent-space conversion for parented layers', () => {
    const layer = createLayer('shape', comp);
    const r = applyPreset(layer, 'slideInLeft', ctx({ toParentDelta: (dx, dy) => [dx / 2, dy / 2] }));
    const start = evaluateProp(r.layer.props.position, 1);
    expect(start[0]).toBeCloseTo(layer.props.position.value[0] - (860 + 200 + 40) / 2);
  });

  it('pop in scales from 0 with an overshoot', () => {
    const r = applyPreset(createLayer('shape', comp), 'popIn', ctx());
    expect(evaluateProp(r.layer.props.scale, 1)).toEqual([0, 0]);
    const samples = Array.from({ length: 20 }, (_, i) => evaluateProp(r.layer.props.scale, 1 + i / 20)[0]);
    expect(Math.max(...samples)).toBeGreaterThan(100);
    expect(evaluateProp(r.layer.props.scale, 2)).toEqual([100, 100]);
  });

  it('bounce in drops from above with bounce easing', () => {
    const r = applyPreset(createLayer('text', comp), 'bounceIn', ctx());
    const keys = r.layer.props.position.keyframes;
    expect(keys[0].easing).toBe('bounce');
    expect(keys[0].value[1]).toBeLessThan(0);
  });

  it('spin in rotates a full turn', () => {
    const r = applyPreset(createLayer('shape', comp), 'spinIn', ctx());
    expect(evaluateProp(r.layer.props.rotation, 1)).toBe(-360);
    expect(evaluateProp(r.layer.props.rotation, 2)).toBe(0);
  });

  it('typewriter and word reveal only work on text', () => {
    const text = createLayer('text', comp, { text: 'Hello world' });
    const tw = applyPreset(text, 'typewriter', ctx());
    expect(tw.ok).toBe(true);
    expect(tw.layer.text?.revealMode).toBe('chars');
    expect(evaluateProp(tw.layer.props.reveal, 1.5)).toBeCloseTo(50);
    const wr = applyPreset(text, 'wordReveal', ctx());
    expect(wr.layer.text?.revealMode).toBe('words');
    expect(wr.layer.text?.revealStyle).toBe('rise');
    const shape = applyPreset(createLayer('shape', comp), 'typewriter', ctx());
    expect(shape.ok).toBe(false);
    expect(shape.reason).toBeTruthy();
  });

  it('wiggle adds a deterministic procedural modifier in the range', () => {
    const layer = createLayer('shape', comp);
    const r = applyPreset(layer, 'wiggle', ctx({ frequency: 3, amplitude: 30, seed: 7 }));
    expect(r.layer.wiggles).toHaveLength(1);
    expect(r.layer.wiggles[0]).toMatchObject({ property: 'position', frequency: 3, amplitude: 30, start: 1, end: 2 });
    const a = evaluateLayer(r.layer, 1.5).position;
    const b = evaluateLayer(r.layer, 1.5).position;
    expect(a).toEqual(b);
    expect(evaluateLayer(r.layer, 0.5).position).toEqual(layer.props.position.value);
    const moved = [1.2, 1.4, 1.6, 1.8].some((t) => {
      const p = evaluateLayer(r.layer, t).position;
      return Math.abs(p[0] - 960) > 0.5;
    });
    expect(moved).toBe(true);
  });

  it('pulse returns to the original scale at the end', () => {
    const r = applyPreset(createLayer('shape', comp), 'pulse', ctx({ duration: 1.2 }));
    expect(evaluateProp(r.layer.props.scale, 2.2)).toEqual([100, 100]);
    expect(r.layer.props.scale.keyframes.length).toBeGreaterThanOrEqual(3);
    const peak = Math.max(...r.layer.props.scale.keyframes.map((k) => k.value[0]));
    expect(peak).toBeCloseTo(112);
  });

  it('float moves up and back', () => {
    const r = applyPreset(createLayer('shape', comp), 'float', ctx({ duration: 2 }));
    const ys = r.layer.props.position.keyframes.map((k) => k.value[1]);
    expect(Math.min(...ys)).toBeLessThan(540);
    expect(ys[ys.length - 1]).toBe(540);
  });

  it('draw on animates trim end and makes sure there is a stroke', () => {
    const layer = createLayer('shape', comp, { shapeKind: 'ellipse' });
    expect(layer.shape?.strokeEnabled).toBe(false);
    const r = applyPreset(layer, 'drawOn', ctx());
    expect(r.layer.shape?.strokeEnabled).toBe(true);
    expect(evaluateProp(r.layer.props.strokeWidth, 0)).toBeGreaterThan(0);
    expect(evaluateProp(r.layer.props.trimEnd, 1)).toBe(0);
    expect(evaluateProp(r.layer.props.trimEnd, 2)).toBe(100);
    expect(applyPreset(createLayer('text', comp), 'drawOn', ctx()).ok).toBe(false);
  });

  it('shake decays back to the start position', () => {
    const layer = createLayer('shape', comp);
    const r = applyPreset(layer, 'shake', ctx({ duration: 0.5 }));
    const keys = r.layer.props.position.keyframes;
    expect(keys.length).toBeGreaterThan(5);
    expect(keys[keys.length - 1].value).toEqual(layer.props.position.value);
    const offsets = keys.map((k) => Math.abs(k.value[0] - 960));
    expect(offsets[1]).toBeGreaterThan(offsets[offsets.length - 2]);
  });

  it('replaces existing keys inside the preset range only', () => {
    let layer = createLayer('shape', comp);
    layer = applyPreset(layer, 'fadeIn', ctx({ time: 0, duration: 4 })).layer;
    const r = applyPreset(layer, 'fadeIn', ctx({ time: 1, duration: 1 }));
    expect(r.layer.props.opacity.keyframes.map((k) => k.time)).toEqual([0, 1, 2, 4]);
  });

  it('every preset has a unique id and normalizes aliases', () => {
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
    expect(normalizePresetId('Fade In')).toBe('fadeIn');
    expect(normalizePresetId('slide-in-left')).toBe('slideInLeft');
    expect(normalizePresetId('pop')).toBe('popIn');
    expect(normalizePresetId('Draw On')).toBe('drawOn');
    expect(normalizePresetId('word-by-word')).toBe('wordReveal');
    expect(normalizePresetId('explode')).toBeNull();
  });

  it('refuses fades on null layers', () => {
    expect(applyPreset(createLayer('null', comp), 'fadeIn', ctx()).ok).toBe(false);
    expect(applyPreset(createLayer('null', comp), 'slideInLeft', ctx()).ok).toBe(true);
  });
});
