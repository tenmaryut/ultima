import { describe, expect, it } from 'vitest';
import { stampText } from './types';

describe('stampText', () => {
  const toIndonesian = (s: string) => ({ APPROVED: 'Disetujui' })[s] ?? s;

  it('shows built-in stamps in the UI language, upper case', () => {
    expect(stampText('APPROVED', toIndonesian)).toBe('DISETUJUI');
    expect(stampText('APPROVED', (s) => s)).toBe('APPROVED');
  });

  it('keeps custom stamp text as typed', () => {
    expect(stampText('  lunas 50%  ', toIndonesian)).toBe('LUNAS 50%');
  });
});
