import { describe, expect, it } from 'vitest';
import { registerTranslations, translate } from './i18n';

describe('translate', () => {
  registerTranslations('id', { Save: 'Simpan', Bold: 'Tebal', '{n} layers': '{n} layer' });
  registerTranslations('id', { Bold: 'Berani', 'Tone of voice': 'Nada bicara' }, 'test-ai');
  registerTranslations('id', { Fill: 'Isian' }, 'test-vector');
  registerTranslations('id', { Fill: 'Isi' }, 'test-layout');

  it('returns English unchanged', () => {
    expect(translate('en', 'Bold', undefined, 'test-ai')).toBe('Bold');
  });

  it("prefers the module's own wording inside its scope", () => {
    expect(translate('id', 'Bold', undefined, 'test-ai')).toBe('Berani');
    expect(translate('id', 'Fill', undefined, 'test-vector')).toBe('Isian');
    expect(translate('id', 'Fill', undefined, 'test-layout')).toBe('Isi');
  });

  it('keeps one module’s wording out of the others', () => {
    expect(translate('id', 'Bold')).toBe('Tebal');
    expect(translate('id', 'Bold', undefined, 'test-vector')).toBe('Tebal');
  });

  it('falls back to the shared dictionary, then any module, then English', () => {
    expect(translate('id', 'Save', undefined, 'test-ai')).toBe('Simpan');
    expect(translate('id', 'Tone of voice', undefined, 'test-vector')).toBe('Nada bicara');
    expect(translate('id', 'Not translated', undefined, 'test-ai')).toBe('Not translated');
  });

  it('interpolates variables', () => {
    expect(translate('id', '{n} layers', { n: 3 })).toBe('3 layer');
    expect(translate('en', '{n} layers', { n: 3 })).toBe('3 layers');
  });
});
