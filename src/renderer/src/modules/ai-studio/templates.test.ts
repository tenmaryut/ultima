import { describe, expect, it } from 'vitest';
import { TEMPLATES, buildTemplatePrompt, fillTemplate, missingFields, searchTemplates, templateDefaults } from './templates';

describe('fillTemplate', () => {
  it('replaces placeholders', () => {
    expect(fillTemplate('Hello {{name}}, welcome to {{ place }}!', { name: 'Ana', place: 'Bali' })).toBe('Hello Ana, welcome to Bali!');
  });
  it('drops optional parts with empty fields and keeps filled ones', () => {
    const tpl = 'Write a post.[[ Audience: {{audience}}.]][[ Tone: {{tone}}.]] Done.';
    expect(fillTemplate(tpl, { audience: '', tone: 'calm' })).toBe('Write a post. Tone: calm. Done.');
    expect(fillTemplate(tpl, { audience: 'parents', tone: '' })).toBe('Write a post. Audience: parents. Done.');
    expect(fillTemplate(tpl, {})).toBe('Write a post. Done.');
  });
  it('requires every field of an optional part', () => {
    expect(fillTemplate('A[[ {{x}} and {{y}}]]B', { x: '1' })).toBe('AB');
    expect(fillTemplate('A[[ {{x}} and {{y}}]]B', { x: '1', y: '2' })).toBe('A 1 and 2B');
  });
  it('treats unknown placeholders as empty and tidies blank lines', () => {
    expect(fillTemplate('Line 1\n\n\n\n{{nothing}}\n\nLine 2', {})).toBe('Line 1\n\nLine 2');
  });
  it('keeps multiline values intact', () => {
    expect(fillTemplate('Text:\n{{text}}', { text: 'a\n  b\nc' })).toBe('Text:\na\n  b\nc');
  });
});

describe('template library', () => {
  it('has at least 20 templates with unique ids', () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(20);
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length);
  });
  it('every placeholder refers to a declared field', () => {
    for (const t of TEMPLATES) {
      const keys = new Set(t.fields.map((f) => f.key));
      for (const m of t.prompt.matchAll(/\{\{\s*([\w-]+)\s*\}\}/g)) expect(keys.has(m[1]), `${t.id}: ${m[1]}`).toBe(true);
      expect(t.fields.some((f) => f.required), `${t.id} has a required field`).toBe(true);
    }
  });
  it('fills every template with its defaults plus required values', () => {
    for (const t of TEMPLATES) {
      const values = templateDefaults(t);
      expect(missingFields(t, values).length).toBeGreaterThan(0);
      for (const f of t.fields) if (f.required) values[f.key] = 'SAMPLE';
      expect(missingFields(t, values)).toEqual([]);
      const out = buildTemplatePrompt(t, values, 'English');
      expect(out).toContain('SAMPLE');
      expect(out).not.toMatch(/\{\{|\}\}|\[\[|\]\]/);
      if (!t.ownLanguage) expect(out.endsWith('Write the answer in English.')).toBe(true);
    }
  });
  it('covers the creator essentials', () => {
    const ids = TEMPLATES.map((t) => t.id);
    for (const id of ['caption-hashtags', 'youtube-meta', 'blog-outline', 'product-description', 'ad-copy', 'newsletter', 'story-script', 'slogans', 'podcast-notes', 'thumbnail-text', 'brand-voice', 'content-calendar', 'press-release', 'logo-brief', 'palette-idea', 'storyboard', 'translate', 'proofread', 'summarize']) {
      expect(ids).toContain(id);
    }
  });
  it('searches titles, descriptions and translations', () => {
    expect(searchTemplates(TEMPLATES, 'youtube').map((t) => t.id)).toContain('youtube-meta');
    expect(searchTemplates(TEMPLATES, '', 'Language').every((t) => t.category === 'Language')).toBe(true);
    const id = searchTemplates(TEMPLATES, 'terjemah', '', (s) => (s === 'Translate & localize' ? 'Terjemahkan & lokalkan' : s));
    expect(id.map((t) => t.id)).toEqual(['translate']);
  });
});
