import { describe, expect, it } from 'vitest';
import {
  addSwatch,
  baseIndex,
  createDefaultDoc,
  moveSwatch,
  parseProject,
  regenerate,
  removeSwatch,
  replaceColors,
  sanitizeDoc,
  serializeProject,
  setRule,
  setSwatchHex,
  sortSwatches,
  toggleLock,
} from './state';
import { applyColorActions, describeDoc } from './aiActions';
import { colorAt, defaultGradient, gradientCss, gradientCssSnippet, gradientSvg, makeStop } from './gradient';
import { duplicatePalette, parseTags, sanitizeLibrary, searchLibrary } from './library';
import { lightness } from './colormath';

describe('document operations', () => {
  it('default doc is an analogous palette of 5 with the base in the middle', () => {
    const doc = createDefaultDoc();
    expect(doc.swatches).toHaveLength(5);
    expect(baseIndex(doc)).toBe(2);
    expect(new Set(doc.swatches.map((s) => s.hex)).size).toBe(5);
  });
  it('regeneration keeps locked swatches', () => {
    let doc = createDefaultDoc();
    doc = toggleLock(doc, 0, true);
    const locked = doc.swatches[0].hex;
    doc = setRule(doc, 'triad');
    expect(doc.swatches[0].hex).toBe(locked);
    expect(doc.swatches[1].hex).not.toBe(createDefaultDoc().swatches[1].hex);
  });
  it('editing a secondary swatch switches to custom; editing the base regenerates', () => {
    let doc = createDefaultDoc();
    const edited = setSwatchHex(doc, 0, '#123456');
    expect(edited.rule).toBe('custom');
    expect(edited.swatches[0].hex).toBe('#123456');
    doc = setSwatchHex(doc, 2, '#ff0000');
    expect(doc.rule).toBe('analogous');
    expect(doc.swatches[2].hex).toBe('#ff0000');
    expect(doc.swatches[3].hex).not.toBe(createDefaultDoc().swatches[3].hex);
  });
  it('move, add, remove and replace', () => {
    let doc = createDefaultDoc();
    const ids = doc.swatches.map((s) => s.id);
    doc = moveSwatch(doc, 0, 4);
    expect(doc.swatches[4].id).toBe(ids[0]);
    doc = addSwatch(doc, '#00ff00');
    expect(doc.swatches).toHaveLength(6);
    doc = removeSwatch(doc, baseIndex(doc));
    expect(doc.swatches).toHaveLength(5);
    expect(doc.swatches.some((s) => s.id === doc.baseId)).toBe(true);
    doc = toggleLock(doc, 1, true);
    const keep = doc.swatches[1].hex;
    doc = replaceColors(doc, [{ hex: '#000000' }, { hex: '#111111' }, { hex: '#222222' }]);
    expect(doc.swatches.map((s) => s.hex)).toEqual(['#000000', keep, '#222222']);
    expect(doc.rule).toBe('custom');
  });
  it('sorts by lightness', () => {
    const doc = sortSwatches(replaceColors(createDefaultDoc(), [{ hex: '#ffffff' }, { hex: '#000000' }, { hex: '#808080' }]), 'lightness');
    const ls = doc.swatches.map((s) => lightness(s.hex));
    expect(ls).toEqual([...ls].sort((a, b) => a - b));
  });
  it('custom rule regeneration is a no-op', () => {
    const doc = { ...createDefaultDoc(), rule: 'custom' as const };
    expect(regenerate(doc)).toBe(doc);
  });
});

describe('project files', () => {
  it('round-trips', () => {
    const doc = setRule(createDefaultDoc(), 'square');
    const back = parseProject(serializeProject(doc, 'data:image/jpeg;base64,AAAA'));
    expect(back.doc.swatches.map((s) => s.hex)).toEqual(doc.swatches.map((s) => s.hex));
    expect(back.doc.rule).toBe('square');
    expect(back.image).toBe('data:image/jpeg;base64,AAAA');
  });
  it('rejects other modules and sanitizes garbage', () => {
    expect(() => parseProject('{"app":"ultima","module":"photo"}')).toThrow();
    const doc = sanitizeDoc({ swatches: [{ hex: 'nope' }, { hex: '#abc', locked: 'yes', point: { x: 5, y: -1 } }], rule: 'bogus', wheel: 3 });
    expect(doc.swatches).toHaveLength(1);
    expect(doc.swatches[0]).toMatchObject({ hex: '#aabbcc', locked: false, point: { x: 1, y: 0 } });
    expect(doc.rule).toBe('custom');
    expect(doc.wheel).toBe('ryb');
    expect(doc.gradient.stops.length).toBeGreaterThanOrEqual(2);
  });
});

describe('AI actions', () => {
  it('applies valid actions and skips invalid ones', () => {
    const doc = createDefaultDoc();
    const r = applyColorActions(doc, [
      { type: 'setPalette', colors: ['#111111', 'nope', '#eeeeee'], names: ['Ink', 'x', 'Paper'], name: 'Mono' },
      { type: 'explode' },
      { type: 'setSwatch', index: 99, color: '#ff0000' },
      { type: 'setGradient', gradientType: 'radial', angle: 725, stops: [{ color: '#000', position: -20 }, { color: '#fff', position: 300 }] },
      { type: 'setName', name: '  Night  ', tags: ['Dark', 'mono'] },
    ]);
    expect(r.doc.swatches.map((s) => s.hex)).toEqual(['#111111', '#eeeeee']);
    expect(r.doc.swatches[1].name).toBe('Paper'); // names follow the original index of the color list
    expect(r.doc.name).toBe('Night');
    expect(r.doc.tags).toEqual(['dark', 'mono']);
    expect(r.doc.gradient.type).toBe('radial');
    expect(r.doc.gradient.angle).toBe(5);
    expect(r.doc.gradient.stops.map((s) => s.position)).toEqual([0, 100]);
    expect(r.applied).toBe(3);
    expect(r.notes.length).toBe(2);
  });
  it('setBase + setHarmony regenerates the palette', () => {
    const r = applyColorActions(createDefaultDoc(), [
      { type: 'setBase', color: '#ff0000' },
      { type: 'setHarmony', rule: 'complementary', wheel: 'rgb' },
    ]);
    expect(r.doc.rule).toBe('complementary');
    expect(r.doc.swatches[baseIndex(r.doc)].hex).toBe('#ff0000');
    expect(r.doc.swatches.map((s) => s.hex)).toContain('#00ffff');
  });
  it('respects locked swatches', () => {
    const doc = toggleLock(createDefaultDoc(), 0, true);
    const r = applyColorActions(doc, [{ type: 'setSwatch', index: 0, color: '#ffffff' }]);
    expect(r.doc.swatches[0].hex).toBe(doc.swatches[0].hex);
    expect(r.applied).toBe(0);
  });
  it('describes the document', () => {
    const text = describeDoc(createDefaultDoc());
    expect(text).toContain('harmony rule: analogous');
    expect(text).toContain('[BASE]');
  });
});

describe('gradient', () => {
  it('serializes CSS for each type', () => {
    const g = { ...defaultGradient(['#ff0000', '#0000ff']) };
    expect(gradientCss(g)).toBe('linear-gradient(90deg, #ff0000 0%, #0000ff 100%)');
    expect(gradientCss({ ...g, type: 'radial', shape: 'ellipse', cx: 30, cy: 70 })).toBe('radial-gradient(ellipse at 30% 70%, #ff0000 0%, #0000ff 100%)');
    expect(gradientCss({ ...g, type: 'conic', angle: -45 })).toBe('conic-gradient(from 315deg at 50% 50%, #ff0000 0%, #0000ff 100%)');
    const ok = { ...g, interpolation: 'oklab' as const };
    expect(gradientCss(ok)).toBe('linear-gradient(90deg in oklab, #ff0000 0%, #0000ff 100%)');
    expect(gradientCssSnippet(ok).split('\n')).toHaveLength(2);
  });
  it('sorts stops and interpolates', () => {
    const g = { ...defaultGradient(), stops: [makeStop('#ffffff', 100), makeStop('#000000', 0)] };
    expect(gradientCss(g)).toContain('#000000 0%, #ffffff 100%');
    expect(colorAt(g, 50)).toBe('#808080');
    expect(colorAt(g, -5)).toBe('#000000');
  });
  it('exports SVG for linear and radial only', () => {
    const g = defaultGradient(['#ff0000', '#0000ff']);
    expect(gradientSvg(g)).toContain('<linearGradient');
    expect(gradientSvg({ ...g, type: 'radial' })).toContain('<radialGradient');
    expect(gradientSvg({ ...g, type: 'conic' })).toBeNull();
  });
});

describe('library', () => {
  const list = sanitizeLibrary([
    { id: 'a', name: 'Ocean', tags: ['blue', 'calm'], colors: [{ hex: '#1e5eb0', name: 'Deep' }], createdAt: 1, updatedAt: 5 },
    { id: 'b', name: 'Forest', tags: ['green'], colors: [{ hex: '#228b22' }], createdAt: 1, updatedAt: 9 },
    { id: 'c', name: 'Broken', colors: [{ hex: 'zz' }] },
  ]);
  it('drops invalid entries', () => {
    expect(list.map((p) => p.id)).toEqual(['a', 'b']);
  });
  it('searches names, tags, color names and hex', () => {
    expect(searchLibrary(list, '').map((p) => p.id)).toEqual(['b', 'a']);
    expect(searchLibrary(list, 'calm').map((p) => p.id)).toEqual(['a']);
    expect(searchLibrary(list, 'deep ocean').map((p) => p.id)).toEqual(['a']);
    expect(searchLibrary(list, '#228').map((p) => p.id)).toEqual(['b']);
    expect(searchLibrary(list, 'purple')).toEqual([]);
  });
  it('duplicates and parses tags', () => {
    const d = duplicatePalette(list[0]);
    expect(d.id).not.toBe(list[0].id);
    expect(d.name).toBe('Ocean copy');
    expect(parseTags('Summer, #beach, summer\nwarm')).toEqual(['summer', 'beach', 'warm']);
  });
});
