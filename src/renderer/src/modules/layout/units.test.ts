import { describe, expect, it } from 'vitest';
import {
  PAGE_PRESETS,
  convert,
  findPreset,
  fontSizeFromDisplay,
  fontSizeToDisplay,
  formatLength,
  fromUnit,
  matchPreset,
  parseLength,
  presetSizePx,
  toUnit,
} from './units';

describe('unit conversions', () => {
  it('converts between px, mm, in and pt', () => {
    expect(fromUnit(1, 'in')).toBe(96);
    expect(fromUnit(72, 'pt')).toBeCloseTo(96);
    expect(fromUnit(25.4, 'mm')).toBeCloseTo(96);
    expect(toUnit(96, 'mm')).toBeCloseTo(25.4);
    expect(convert(210, 'mm', 'in')).toBeCloseTo(8.2677, 3);
    expect(convert(1, 'in', 'pt')).toBeCloseTo(72);
    expect(convert(123.4, 'mm', 'mm')).toBeCloseTo(123.4);
  });

  it('round-trips values in every unit', () => {
    for (const unit of ['mm', 'in', 'pt', 'px'] as const) {
      for (const v of [0, 1, 12.5, 297, 1080]) expect(toUnit(fromUnit(v, unit), unit)).toBeCloseTo(v, 9);
    }
  });

  it('formats lengths with sensible precision', () => {
    expect(formatLength(fromUnit(210, 'mm'), 'mm')).toBe('210 mm');
    expect(formatLength(96, 'in')).toBe('1 in');
    expect(formatLength(100, 'px', false)).toBe('100');
    expect(formatLength(-0.0001, 'mm', false)).toBe('0');
  });

  it('parses lengths with and without units', () => {
    expect(parseLength('10', 'mm')).toBeCloseTo(fromUnit(10, 'mm'));
    expect(parseLength('2in', 'mm')).toBeCloseTo(192);
    expect(parseLength('2 "', 'mm')).toBeCloseTo(192);
    expect(parseLength('36pt', 'px')).toBeCloseTo(48);
    expect(parseLength('1cm', 'px')).toBeCloseTo(fromUnit(10, 'mm'));
    expect(parseLength('1/2in', 'px')).toBeCloseTo(48);
    expect(parseLength('10+5', 'px')).toBeCloseTo(15);
    expect(parseLength('12,5', 'px')).toBeCloseTo(12.5);
    expect(parseLength('abc', 'px')).toBeNull();
    expect(parseLength('', 'px')).toBeNull();
    expect(parseLength('1/0', 'px')).toBeNull();
  });

  it('shows font sizes in pt for print units and px for pixel documents', () => {
    expect(fontSizeToDisplay(16, 'mm')).toBe(12);
    expect(fontSizeToDisplay(16, 'px')).toBe(16);
    expect(fontSizeFromDisplay(12, 'in')).toBeCloseTo(16);
    expect(fontSizeFromDisplay(30, 'px')).toBe(30);
  });
});

describe('page presets', () => {
  it('includes all the required formats', () => {
    const ids = PAGE_PRESETS.map((p) => p.id);
    for (const id of [
      'a4',
      'a5',
      'a3',
      'letter',
      'legal',
      'tabloid',
      'poster',
      'business-card',
      'flyer',
      'instagram-post',
      'instagram-story',
      'facebook-cover',
      'youtube-thumbnail',
      'linkedin-banner',
      'presentation',
    ]) {
      expect(ids).toContain(id);
    }
  });

  it('computes preset sizes in px', () => {
    const a4 = presetSizePx(findPreset('a4')!);
    expect(a4.width).toBeCloseTo(793.7, 1);
    expect(a4.height).toBeCloseTo(1122.5, 1);
    expect(presetSizePx(findPreset('youtube-thumbnail')!)).toEqual({ width: 1280, height: 720 });
    expect(presetSizePx(findPreset('business-card')!).width).toBeCloseTo(321.26, 1);
  });

  it('finds presets by id or name', () => {
    expect(findPreset('A4')?.id).toBe('a4');
    expect(findPreset('Instagram story')?.id).toBe('instagram-story');
    expect(findPreset('youtube_thumbnail')?.id).toBe('youtube-thumbnail');
    expect(findPreset('nonsense')).toBeUndefined();
  });

  it('matches sizes to presets in both orientations', () => {
    expect(matchPreset(1080, 1920)?.id).toBe('instagram-story');
    expect(matchPreset(1122.5, 793.7)?.id).toBe('a4');
    expect(matchPreset(1000, 1000)).toBeUndefined();
  });
});

describe('page ranges', () => {
  it('parses lists and ranges', async () => {
    const { parsePageRange } = await import('./units');
    expect(parsePageRange('1-3, 5', 10)).toEqual([0, 1, 2, 4]);
    expect(parsePageRange('8-', 10)).toEqual([7, 8, 9]);
    expect(parsePageRange('-2', 10)).toEqual([0, 1]);
    expect(parsePageRange('3 1 3', 10)).toEqual([0, 2]);
    expect(parsePageRange('2-20', 5)).toEqual([1, 2, 3, 4]);
    expect(parsePageRange('0', 5)).toBeNull();
    expect(parsePageRange('6', 5)).toBeNull();
    expect(parsePageRange('a', 5)).toBeNull();
    expect(parsePageRange('', 5)).toBeNull();
    expect(parsePageRange('4-2', 5)).toBeNull();
  });
});
