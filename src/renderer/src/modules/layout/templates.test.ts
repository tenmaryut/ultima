import { describe, expect, it } from 'vitest';
import { parseColor } from '../../core/utils/color';
import { normalizeDoc } from './model';
import { threadOf } from './ops';
import { resolveColor, resolveTextStyle } from './styles';
import { TEMPLATES, buildTemplate, findTemplate } from './templates';
import type { Frame, LayoutDoc } from './types';
import { matchPreset } from './units';
import { pageNode, toHtml } from './vnode';

function colorsOf(f: Frame): string[] {
  switch (f.type) {
    case 'text':
      return [f.fill, f.stroke, f.overrides.color ?? ''];
    case 'shape':
      return [f.fill, f.stroke, ...(f.gradient?.stops.map((s) => s.color) ?? [])];
    case 'image':
      return [f.placeholder, f.stroke];
    case 'table':
      return [f.fill, f.stroke, f.color, f.headerFill, f.headerColor, f.bandFill];
  }
}

/** Errors in a template document (empty = valid). */
function validateTemplate(doc: LayoutDoc): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const styleIds = new Set(doc.styles.map((s) => s.id));
  if (doc.swatches.length < 6) errors.push('needs 6 theme colors');
  doc.swatches.forEach((c) => !parseColor(c) && errors.push(`bad swatch ${c}`));
  const all = [...doc.master.frames, ...doc.pages.flatMap((p) => p.frames)];
  for (const f of all) {
    if (ids.has(f.id)) errors.push(`duplicate id ${f.id}`);
    ids.add(f.id);
    for (const c of colorsOf(f)) {
      if (!c) continue;
      const resolved = resolveColor(c, doc.swatches, 'INVALID');
      if (!parseColor(resolved)) errors.push(`bad color ${c} in ${f.id}`);
    }
    if (f.type === 'text') {
      if (f.styleId && !styleIds.has(f.styleId)) errors.push(`unknown style ${f.styleId}`);
      if (f.nextId && !ids.has(f.nextId) && !all.some((x) => x.id === f.nextId)) errors.push(`broken thread ${f.id}`);
    }
    if (!(f.w > 0 && f.h > 0)) errors.push(`empty frame ${f.id}`);
    if (f.type === 'text' && f.text && !f.nextId) {
      // every explicit line must fit vertically (wrapping is checked visually)
      const st = resolveTextStyle(f, doc.styles);
      const lines = f.text.split('\n').length;
      const need = lines * st.fontSize * st.lineHeight + (lines - 1) * st.spaceAfter + 2 * f.padding;
      if (need > f.h + 0.5 && f.columns === 1) errors.push(`text "${f.text.slice(0, 24)}" needs ${need.toFixed(1)}px but frame is ${f.h}px`);
    }
  }
  for (const p of doc.pages) {
    if (!matchPreset(p.width, p.height) && p.preset !== 'custom') errors.push(`page size ${p.width}x${p.height} does not match preset ${p.preset}`);
    for (const f of p.frames) {
      // everything must be (at least partly) on the page
      if (f.x > p.width || f.y > p.height || f.x + f.w < 0 || f.y + f.h < 0) errors.push(`frame ${f.id} is off the page`);
      if (f.type === 'text' && f.text && (f.x < -1 || f.y < -1 || f.x + f.w > p.width + 1 || f.y + f.h > p.height + 1) && !f.rotation) {
        errors.push(`text frame "${f.text.slice(0, 20)}" extends beyond the page`);
      }
    }
  }
  return errors;
}

describe('templates', () => {
  it('provides at least 12 templates including the required ones', () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(12);
    for (const name of [
      'Event poster',
      'Sale flyer',
      'Business card',
      'Instagram post',
      'Instagram story',
      'YouTube thumbnail',
      'Resume / CV',
      'Newsletter',
      'Invitation',
      'Certificate',
      'Restaurant menu',
      'Presentation deck',
    ]) {
      expect(findTemplate(name), name).toBeTruthy();
    }
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length);
  });

  for (const def of TEMPLATES) {
    it(`builds a valid "${def.name}" document`, () => {
      const doc = buildTemplate(def);
      expect(validateTemplate(doc)).toEqual([]);
      expect(doc.pages.length).toBeGreaterThan(0);
      expect(doc.pages.every((p) => p.frames.length >= 3)).toBe(true);
      // survives the project file validation unchanged
      expect(normalizeDoc(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
      // renders to markup
      doc.pages.forEach((page, i) => {
        const html = toHtml(pageNode({ doc, page, pageIndex: i, withMaster: true }));
        expect(html.length).toBeGreaterThan(100);
      });
      // fresh ids on every build
      const again = buildTemplate(def);
      expect(again.pages[0].frames[0].id).not.toBe(doc.pages[0].frames[0].id);
    });
  }

  it('has the expected multi-page templates', () => {
    expect(buildTemplate(findTemplate('newsletter')!).pages).toHaveLength(2);
    expect(buildTemplate(findTemplate('presentation')!).pages).toHaveLength(3);
    const news = buildTemplate(findTemplate('newsletter')!);
    const head = news.pages[0].frames.find((f) => f.type === 'text' && f.nextId)!;
    expect(threadOf(news, head.id)).toHaveLength(2);
    expect(news.master.frames.some((f) => f.type === 'text' && f.text.includes('{page}'))).toBe(true);
  });
});
