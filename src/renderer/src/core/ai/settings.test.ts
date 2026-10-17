import { describe, expect, it } from 'vitest';
import { DEFAULT_AI_SETTINGS, MAX_TIMEOUT_MINUTES, migrateAISettings } from './settings';

describe('AI settings', () => {
  it('give agent AIs two hours by default and allow up to a day', () => {
    expect(DEFAULT_AI_SETTINGS.timeoutSec).toBe(2 * 60 * 60);
    expect(MAX_TIMEOUT_MINUTES).toBe(24 * 60);
  });

  it('move the old 5-minute default to 2 hours once and keep a limit the user chose', () => {
    expect(migrateAISettings({ timeoutSec: 300, autoApply: true }, 0)).toMatchObject({ timeoutSec: 7200, autoApply: true });
    expect(migrateAISettings({ timeoutSec: 900 }, 0).timeoutSec).toBe(900);
    expect(migrateAISettings({ timeoutSec: 300 }, 1).timeoutSec).toBe(300); // chosen after the upgrade
    expect(migrateAISettings(undefined, 0)).toEqual({});
  });
});
