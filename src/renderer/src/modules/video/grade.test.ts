import { describe, expect, it } from 'vitest';
import { bakeGrade, cleanCurve, curveTable, decodeLut, encodeLut, gradeActive, gradeColor, LOOKS, parseCube, sampleLut } from './grade';
import { applyPixels, NO_PIXELS } from './pixelfx';
import { parseProject, serializeProject } from './project';
import { addMediaToTimeline, createProject, getClip, makeClip, insertClips, updateClip } from './model';
import type { LutAsset, MediaRef } from './types';

const identityCube = (n: number) => {
  const rows: string[] = ['TITLE "id"', `LUT_3D_SIZE ${n}`];
  for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) rows.push(`${r / (n - 1)} ${g / (n - 1)} ${b / (n - 1)}`);
  return rows.join('\n');
};

describe('curves', () => {
  it('cleans points (also 0-255) and keeps the curve monotone', () => {
    expect(cleanCurve([[64, 32], [192, 224]])).toEqual([[0, 0], [64 / 255, 32 / 255], [192 / 255, 224 / 255], [1, 1]]);
    expect(cleanCurve('nope')).toBeNull();
    const table = curveTable(cleanCurve([[0, 0], [0.25, 0.15], [0.75, 0.85], [1, 1]])!);
    for (let i = 1; i < 256; i++) expect(table[i]).toBeGreaterThanOrEqual(table[i - 1] - 1e-6);
    expect(table[64]).toBeLessThan(0.25);
    expect(table[191]).toBeGreaterThan(0.75);
    expect(table[0]).toBe(0);
    expect(table[255]).toBe(1);
  });
});

describe('grades', () => {
  it('is neutral without settings and recognises active parts', () => {
    expect(gradeActive(undefined)).toBe(false);
    expect(gradeActive({ lookAmount: 1, lutAmount: 1 })).toBe(false);
    expect(gradeActive({ look: 'bw', lookAmount: 0, lutAmount: 1 })).toBe(false);
    expect(gradeActive({ look: 'bw', lookAmount: 1, lutAmount: 1 })).toBe(true);
    expect(gradeActive({ lut: 'l1', lutAmount: 1, lookAmount: 1 })).toBe(false); // unknown LUT
  });

  it('applies looks with an amount', () => {
    const bw = gradeColor([0.8, 0.2, 0.1], { look: 'bw', lookAmount: 1, lutAmount: 1 }, {}, null);
    expect(Math.abs(bw[0] - bw[1])).toBeLessThan(1e-6);
    const half = gradeColor([0.8, 0.2, 0.1], { look: 'bw', lookAmount: 0.5, lutAmount: 1 }, {}, null);
    expect(half[0]).toBeGreaterThan(half[1]);
    // every look keeps colors inside 0-1 and changes something
    for (const look of LOOKS) {
      const c = gradeColor([0.6, 0.4, 0.3], { look: look.id, lookAmount: 1, lutAmount: 1 }, {}, null);
      expect(c.every((x) => x >= 0 && x <= 1)).toBe(true);
      expect(c).not.toEqual([0.6, 0.4, 0.3]);
    }
  });

  it('shifts only the chosen hue range', () => {
    const g = { lookAmount: 1, lutAmount: 1, hsl: { blue: { h: 0, s: -100, l: 0 } } };
    const blue = gradeColor([0.1, 0.2, 0.9], g, {}, null);
    expect(Math.max(...blue) - Math.min(...blue)).toBeLessThan(0.05);
    const red = gradeColor([0.9, 0.1, 0.1], g, {}, null);
    expect(red[0]).toBeCloseTo(0.9, 2);
  });

  it('bakes the grade into a table that the pixels then use', () => {
    const lut = bakeGrade({ look: 'noir', lookAmount: 1, lutAmount: 1 }, [], 17);
    expect(lut.size).toBe(17);
    const direct = gradeColor([0.3, 0.5, 0.7], { look: 'noir', lookAmount: 1, lutAmount: 1 }, {}, null);
    const viaTable = sampleLut(lut, 0.3, 0.5, 0.7);
    viaTable.forEach((v, i) => expect(v).toBeCloseTo(direct[i], 1));
  });
});

describe('.cube LUTs', () => {
  it('parses, packs and samples a table', () => {
    const lut = parseCube(identityCube(5));
    expect(lut.size).toBe(5);
    expect(sampleLut(lut, 0.3, 0.6, 0.9).map((v) => +v.toFixed(4))).toEqual([0.3, 0.6, 0.9]);
    const asset: LutAsset = { id: 'lut_a', name: 'id', size: lut.size, data: encodeLut(lut) };
    const back = decodeLut(asset)!;
    expect(back.data[back.data.length - 1]).toBeCloseTo(1, 4);
    // an inverting table, applied through a grade
    const inv = { size: 2, data: Float32Array.from([1, 1, 1, 0, 1, 1, 1, 0, 1, 0, 0, 1, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0]) };
    const invAsset: LutAsset = { id: 'lut_inv', name: 'inv', size: 2, data: encodeLut(inv) };
    expect(gradeColor([0.2, 0.4, 0.6], { lut: 'lut_inv', lutAmount: 1, lookAmount: 1 }, {}, decodeLut(invAsset)).map((v) => +v.toFixed(3))).toEqual([0.8, 0.6, 0.4]);
  });

  it('rejects broken files', () => {
    expect(() => parseCube('LUT_3D_SIZE 2\n0 0 0\n1 1 1')).toThrow(/expected 8 rows/);
    expect(() => parseCube('hello')).toThrow(/not a \.cube/);
    expect(() => parseCube('LUT_3D_SIZE 2\n0 0 x')).toThrow();
    expect(parseCube('LUT_1D_SIZE 2\n0 0 0\n1 1 1').size).toBe(33);
  });
});

describe('pixels on the CPU', () => {
  const px = (r: number, g: number, b: number, a = 255) => Uint8ClampedArray.from([r, g, b, a]);
  it('does nothing without effects', () => {
    const d = px(10, 20, 30);
    applyPixels(d, 1, 1, NO_PIXELS);
    expect([...d]).toEqual([10, 20, 30, 255]);
  });

  it('keys out green, darkens edges and fades by brightness', () => {
    const green = px(0, 255, 0);
    applyPixels(green, 1, 1, { ...NO_PIXELS, chroma: { r: 0, g: 255, b: 0, similarity: 0.3, smoothness: 0.1 } });
    expect(green[3]).toBe(0);
    const img = new Uint8ClampedArray(9 * 4).fill(200);
    applyPixels(img, 3, 3, { ...NO_PIXELS, vignette: 1 });
    expect(img[0]).toBeLessThan(img[4 * 4]); // corner darker than the center
    const dark = px(20, 20, 20);
    applyPixels(dark, 1, 1, { ...NO_PIXELS, luma: { threshold: 0.5, softness: 0.1 } });
    expect(dark[3]).toBe(0);
  });

  it('splits red and blue sideways', () => {
    // a white pixel in the middle of three
    const row = Uint8ClampedArray.from([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255]);
    applyPixels(row, 3, 1, { ...NO_PIXELS, split: { x: 1, y: 0 } });
    expect([row[8], row[10]]).toEqual([255, 0]); // red moved right
    expect([row[0], row[2]]).toEqual([0, 255]); // blue moved left
  });
});

describe('project files', () => {
  const media: MediaRef = { id: 'm1', name: 'a.mp4', kind: 'video', duration: 30, width: 1920, height: 1080, size: 1, mime: 'video/mp4', hasAudio: false };
  it('keeps effects, grades, masks, blend modes, LUTs and adjustment layers', () => {
    const r = addMediaToTimeline({ ...createProject(), media: [media] }, media, { start: 0, duration: 4 });
    const lut = parseCube(identityCube(3));
    let p = { ...r.project, luts: [{ id: 'lut_1', name: 'Film', size: 3, data: encodeLut(lut) }] };
    p = updateClip(p, r.ids[0], (c) => ({
      ...c,
      visual: { ...c.visual!, glow: 0.5, shake: 12, letterbox: 0.1 },
      blend: 'screen',
      mask: { shape: 'ellipse', x: 0.5, y: 0.4, w: 0.5, h: 0.5, rotation: 10, feather: 0.1, invert: true },
      grade: { look: 'tealOrange', lookAmount: 0.7, lut: 'lut_1', lutAmount: 0.5, curves: { master: [[0, 0], [0.5, 0.6], [1, 1]] }, hsl: { orange: { h: 5, s: 10, l: 0 } } },
      transitionOut: { kind: 'whipLeft', duration: 0.4 },
    }));
    const adj = makeClip('adjustment', p.tracks[1].id, 1, 2, { name: 'Adjustment' });
    p = insertClips(p, [adj]);
    const back = parseProject(serializeProject(p));
    const c = getClip(back, r.ids[0])!;
    expect([c.visual!.glow, c.visual!.shake, c.visual!.letterbox, c.blend, c.mask?.invert, c.transitionOut?.kind]).toEqual([0.5, 12, 0.1, 'screen', true, 'whipLeft']);
    expect(c.grade).toEqual(p.clips.find((x) => x.id === r.ids[0])!.grade);
    expect(back.luts).toHaveLength(1);
    expect(getClip(back, adj.id)?.kind).toBe('adjustment');
    // a grade pointing at a missing LUT keeps the rest
    const raw = JSON.parse(serializeProject(p));
    raw.luts = [];
    expect(getClip(parseProject(raw), r.ids[0])!.grade?.lut).toBeUndefined();
  });
});
