import { describe, expect, it } from 'vitest';
import { parseCullAnswer, parseLookAnswer, resolveParamName, validateActions } from './ai';
import { matchFiles, parseCatalog, serializeCatalog } from './catalog';
import { applyTemplate, exportSize, extractExifSegment, insertExif, safeFileName, uniqueFileName } from './export-utils';
import { autoTone, computeHistogram, histogramStats, percentile } from './histogram';
import { commitHistory, jumpHistory, newHistory, redoHistory, undoHistory } from './history';
import {
  DEFAULT_SETTINGS,
  clampParam,
  defaultSettings,
  describeChange,
  isEdited,
  keysOfGroups,
  mergeSettings,
  nonDefault,
  pickGroups,
  resetGroups,
  sanitizeAspect,
  sanitizeSettings,
} from './params';
import { BUILTIN_PRESETS, findPreset, parseUserPresets } from './presets';
import { DEFAULT_FILTER, matchesFilter, nextSelection, visiblePhotos, type Photo } from './types';
import { FIXTURES, fromBase64 } from './fixtures.test-data';

describe('settings', () => {
  it('clamps and rounds parameters', () => {
    expect(clampParam('exposure', 9)).toBe(5);
    expect(clampParam('contrast', 12.6)).toBe(13);
    expect(clampParam('rotate', 5)).toBe(1);
    expect(clampParam('temp', Number.NaN)).toBe(0);
  });
  it('merges only valid fields', () => {
    const s = mergeSettings(defaultSettings(), { exposure: '1.5', bogus: 3, treatment: 'bw', curveRgb: [[0.5, 0.5], [0, 0.1], [1, 0.9]], flipH: 'yes' });
    expect(s.exposure).toBe(1.5);
    expect(s.treatment).toBe('bw');
    expect(s.curveRgb[0]).toEqual([0, 0.1]);
    expect(s.flipH).toBe(false);
    expect('bogus' in s).toBe(false);
  });
  it('sanitizes catalogs and keeps crops inside the frame', () => {
    const s = sanitizeSettings({ cropX: 0.9, cropW: 0.5, cropAspect: '16x9' });
    expect(s.cropX + s.cropW).toBeLessThanOrEqual(1);
    expect(s.cropAspect).toBe('16:9');
    expect(sanitizeAspect('weird')).toBe('original');
  });
  it('groups, resets and diffs', () => {
    const s = mergeSettings(defaultSettings(), { exposure: 1, hueRed: 20, straighten: 3 });
    expect(Object.keys(pickGroups(s, ['tone']))).toContain('exposure');
    expect(keysOfGroups(['transform'])).toContain('straighten');
    const r = resetGroups(s, ['tone']);
    expect(r.exposure).toBe(0);
    expect(r.hueRed).toBe(20);
    expect(isEdited(defaultSettings())).toBe(false);
    expect(nonDefault(s)).toEqual({ exposure: 1, hueRed: 20, straighten: 3 });
    expect(describeChange(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, exposure: 1 })).toBe('Exposure');
  });
});

describe('presets', () => {
  it('has at least 14 valid built-in looks with unique ids', () => {
    expect(BUILTIN_PRESETS.length).toBeGreaterThanOrEqual(14);
    expect(new Set(BUILTIN_PRESETS.map((p) => p.id)).size).toBe(BUILTIN_PRESETS.length);
    for (const name of ['Auto', 'Vivid', 'Matte', 'B&W Classic', 'B&W High Contrast', 'Film Warm', 'Film Cool', 'Cinematic Teal & Orange', 'Vintage Fade', 'Portrait Soft', 'Landscape Punch', 'Moody Dark', 'Bright & Airy', 'Sepia'])
      expect(BUILTIN_PRESETS.some((p) => p.name === name)).toBe(true);
    for (const p of BUILTIN_PRESETS) {
      const merged = mergeSettings(defaultSettings(), p.settings);
      for (const [k, v] of Object.entries(p.settings)) expect(merged[k as keyof typeof merged]).toEqual(v);
    }
  });
  it('finds presets by fuzzy name', () => {
    expect(findPreset('teal & orange', BUILTIN_PRESETS)?.name).toBe('Cinematic Teal & Orange');
    expect(findPreset('bw classic', BUILTIN_PRESETS)?.name).toBe('B&W Classic');
  });
  it('validates stored user presets', () => {
    const list = parseUserPresets([{ name: ' Mine ', settings: { exposure: 99, nope: 1 } }, { name: '' }, null]);
    expect(list).toHaveLength(1);
    expect(list[0].settings).toEqual({ exposure: 5 });
  });
});

describe('history', () => {
  it('records, undoes, redoes and jumps', () => {
    const a = defaultSettings();
    const b = { ...a, exposure: 1 };
    const c = { ...b, contrast: 20 };
    let h = newHistory(a);
    h = commitHistory(h, b, 'Exposure');
    h = commitHistory(h, c, 'Contrast');
    expect(h.past.map((p) => p.label)).toEqual(['Exposure', 'Contrast']);
    const u = undoHistory(h, c)!;
    expect(u.settings).toBe(b);
    const r = redoHistory(u.history, u.settings)!;
    expect(r.settings).toBe(c);
    const j = jumpHistory(r.history, r.settings, -1);
    expect(j.settings).toBe(a);
    expect(j.history.future).toHaveLength(2);
  });
  it('merges repeated steps when asked', () => {
    const a = defaultSettings();
    let h = commitHistory(newHistory(a), { ...a, exposure: 0.1 }, 'Exposure');
    h = commitHistory(h, { ...a, exposure: 0.2 }, 'Exposure', true);
    expect(h.past).toHaveLength(1);
    expect(h.anchor.exposure).toBe(0.2);
  });
  it('undo of an uncommitted live edit returns to the anchor', () => {
    const a = defaultSettings();
    const h = newHistory(a);
    const r = undoHistory(h, { ...a, exposure: 2 })!;
    expect(r.settings).toBe(a);
  });
});

describe('histogram + auto tone', () => {
  const image = (value: number) => {
    const px = new Uint8Array(64 * 4);
    for (let i = 0; i < 64; i++) px.set([value + (i % 8), value + (i % 5), value, 255], i * 4);
    return px;
  };
  it('computes percentiles and clipping', () => {
    const h = computeHistogram(new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255, 128, 128, 128, 255]));
    expect(h.total).toBe(3);
    expect(percentile(h.l, h.total, 0.5)).toBe(128);
    const s = histogramStats(h);
    expect(s.shadowsClipped && s.highlightsClipped).toBe(true);
  });
  it('brightens dark photos and darkens bright ones', () => {
    expect(autoTone(computeHistogram(image(30))).exposure!).toBeGreaterThan(0.5);
    expect(autoTone(computeHistogram(image(220))).exposure!).toBeLessThan(0);
  });
});

describe('catalog', () => {
  const record = (name: string, extra: Partial<Parameters<typeof serializeCatalog>[1][number]['record']> = {}) => ({
    id: name,
    name,
    size: 10,
    lastModified: 1,
    copyIndex: 0,
    rating: 3,
    flag: 'pick' as const,
    label: 'red' as const,
    settings: mergeSettings(defaultSettings(), { exposure: 0.5 }),
    addedAt: 5,
    ...extra,
  });
  it('round-trips settings, ratings and embedded data', () => {
    const parts = serializeCatalog({ name: 'Trip', activeId: 'a.jpg', selected: ['a.jpg'] }, [
      { record: record('a.jpg'), data: { mime: 'image/jpeg', base64: 'AAEC' } },
      { record: record('b.jpg', { masterId: 'a.jpg', copyIndex: 1 }) },
    ]);
    const parsed = parseCatalog(parts.join(''));
    expect(parsed.name).toBe('Trip');
    expect(parsed.embedded).toBe(true);
    expect(parsed.records[0].data).toBe('data:image/jpeg;base64,AAEC');
    expect(parsed.records[0].settings.exposure).toBe(0.5);
    expect(parsed.records[0].rating).toBe(3);
    expect(parsed.records[1].masterId).toBe('a.jpg');
  });
  it('rejects other files and repairs bad values', () => {
    expect(() => parseCatalog('{"app":"ultima","module":"photo"}')).toThrow();
    const p = parseCatalog({ app: 'ultima', module: 'develop', photos: [{ name: 'x.jpg', rating: 9, flag: 'maybe', settings: { exposure: 42 } }] });
    expect(p.records[0].rating).toBe(5);
    expect(p.records[0].flag).toBeNull();
    expect(p.records[0].settings.exposure).toBe(5);
  });
  it('matches re-imported files by name, preferring equal size', () => {
    const m = matchFiles(
      [
        { name: 'IMG_1.jpg', size: 100 },
        { name: 'img_2.JPG', size: 50 },
      ],
      [
        { name: 'img_2.jpg', size: 50 },
        { name: 'IMG_1.jpg', size: 999 },
        { name: 'IMG_1.jpg', size: 100 },
      ],
    );
    expect(m.get(0)).toBe(2);
    expect(m.get(1)).toBe(0);
  });
});

describe('export helpers', () => {
  it('computes output sizes', () => {
    expect(exportSize(6000, 4000, 'long', 2048, false)).toMatchObject({ width: 2048, height: 1365 });
    expect(exportSize(1000, 500, 'long', 2048, false).width).toBe(1000);
    expect(exportSize(1000, 500, 'long', 2000, true).width).toBe(2000);
    const mp = exportSize(6000, 4000, 'megapixels', 6, false);
    expect(Math.abs(mp.width * mp.height - 6e6)).toBeLessThan(2e4);
  });
  it('applies file name templates safely and uniquely', () => {
    expect(applyTemplate('{name}_{n}', { name: 'IMG', n: 3, total: 120, date: new Date(2024, 4, 1).getTime() })).toBe('IMG_003');
    expect(applyTemplate('{date}-{unknown}', { name: 'x', n: 1, total: 1, date: new Date(2024, 4, 1).getTime() })).toBe('2024-05-01-{unknown}');
    expect(safeFileName('a/b:c?.jpg')).toBe('a_b_c_.jpg');
    const used = new Set<string>();
    expect(uniqueFileName('a', 'jpg', used)).toBe('a.jpg');
    expect(uniqueFileName('A', 'jpg', used)).toBe('A-2.jpg');
  });
  it('copies EXIF into an exported JPEG with orientation reset', () => {
    const src = fromBase64(FIXTURES.jpeg_exif);
    const app1 = extractExifSegment(src)!;
    expect(app1).not.toBeNull();
    const out = insertExif(fromBase64(FIXTURES.jpeg_plain), app1);
    expect(out.length).toBe(fromBase64(FIXTURES.jpeg_plain).length + app1.length);
  });
});

describe('AI validation', () => {
  it('resolves parameter aliases', () => {
    expect(resolveParamName('Temperature')).toBe('temp');
    expect(resolveParamName('red_saturation')).toBe('satRed');
    expect(resolveParamName('shadowsHue')).toBe('gradeShadowHue');
    expect(resolveParamName('cropX')).toBeNull();
    expect(resolveParamName('nonsense')).toBeNull();
  });
  it('validates and clamps actions, ignoring unknown ones', () => {
    const { ops, ignored } = validateActions(
      [
        { type: 'set', params: { exposure: 12, contrast: '+20', foo: 1, treatment: 'black and white' } },
        { type: 'adjust', params: { temp: 15 } },
        { type: 'curve', channel: 'red', points: [[0, 10], [255, 240]] },
        { type: 'preset', name: 'film warm' },
        { type: 'crop', aspect: '16:9', straighten: 99 },
        { type: 'rotate', direction: 'left' },
        { type: 'reset', section: 'hsl' },
        { type: 'rate', rating: 9, flag: 'picked', label: 'Blue', target: 'selected' },
        { type: 'explode' },
      ],
      BUILTIN_PRESETS,
    );
    expect(ops.map((o) => o.op.type)).toEqual(['set', 'adjust', 'curve', 'preset', 'crop', 'rotate', 'reset', 'rate']);
    const set = ops[0].op as { params: Record<string, unknown> };
    expect(set.params).toEqual({ exposure: 5, contrast: 20, treatment: 'bw' });
    const curve = ops[2].op as { points: number[][] };
    expect(curve.points[0][1]).toBeCloseTo(10 / 255, 9);
    expect((ops[4].op as { straighten: number }).straighten).toBe(45);
    expect(ops[7].selected).toBe(true);
    expect((ops[7].op as { rating: number; label: string }).rating).toBe(5);
    expect((ops[7].op as { label: string }).label).toBe('blue');
    expect(ignored).toContain('foo');
    expect(ignored).toContain('explode');
  });
  it('parses look and cull answers', () => {
    const look = parseLookAnswer({ message: 'Warm film', settings: { temp: 20, grainAmount: 30, straighten: 5 }, curve: { rgb: [[0, 20], [255, 240]] } });
    expect(look.settings).toMatchObject({ temp: 20, grainAmount: 30 });
    expect('straighten' in look.settings).toBe(false);
    expect(look.settings.curveRgb?.length).toBe(2);
    const cull = parseCullAnswer({ ratings: [{ index: 1, rating: 4, flag: 'pick', reason: 'sharp' }, { index: 9, rating: 2 }, { index: 2, rating: 7, flag: 'reject' }] }, 2);
    expect(cull).toEqual([
      { index: 0, rating: 4, flag: 'pick', reason: 'sharp' },
      { index: 1, rating: 5, flag: 'reject', reason: '' },
    ]);
  });
});

describe('library filters and selection', () => {
  const photo = (id: string, extra: Partial<Photo> = {}): Photo => ({
    id,
    name: `${id}.jpg`,
    copyIndex: 0,
    file: null,
    source: null,
    kind: 'image',
    orientation: 1,
    size: 1,
    lastModified: 0,
    width: 0,
    height: 0,
    exif: null,
    captureDate: 0,
    rating: 0,
    flag: null,
    label: null,
    settings: defaultSettings(),
    thumbState: 'idle',
    addedAt: 0,
    ...extra,
  });
  it('filters by rating, flag, label and text; sorts naturally', () => {
    const list = [photo('img10', { rating: 4, flag: 'pick' }), photo('img2', { rating: 2, label: 'red' }), photo('img1', { flag: 'reject' })];
    expect(visiblePhotos(list, { ...DEFAULT_FILTER, rating: 3 }, 'name', false).map((p) => p.id)).toEqual(['img10']);
    expect(visiblePhotos(list, { ...DEFAULT_FILTER, flag: 'notRejected' }, 'name', false).map((p) => p.id)).toEqual(['img2', 'img10']);
    expect(matchesFilter(list[1], { ...DEFAULT_FILTER, label: 'red' })).toBe(true);
    expect(visiblePhotos(list, { ...DEFAULT_FILTER, text: 'img1' }, 'rating', true).map((p) => p.id)).toEqual(['img10', 'img1']);
  });
  it('supports ctrl/shift selection', () => {
    const order = ['a', 'b', 'c', 'd'];
    expect(nextSelection(order, ['a'], 'a', 'c', 'range')).toEqual(['a', 'b', 'c']);
    expect(nextSelection(order, ['a', 'b'], 'a', 'b', 'toggle')).toEqual(['a']);
    expect(nextSelection(order, ['a', 'b'], 'a', 'd', 'single')).toEqual(['d']);
  });
});
