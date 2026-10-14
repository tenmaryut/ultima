import { app } from 'electron';
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';

/**
 * Tiny JSON store in the user data folder for settings that must live in the main
 * process (anything that decides which program gets executed, plus recent files).
 */
export class JsonStore<T extends object> {
  private data: T;
  private readonly file: string;

  constructor(name: string, defaults: T) {
    this.file = join(app.getPath('userData'), `${name}.json`);
    this.data = { ...defaults };
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<T>;
      if (parsed && typeof parsed === 'object') this.data = { ...defaults, ...parsed };
    } catch {
      // first run or unreadable file: keep defaults
    }
  }

  get(): T {
    return this.data;
  }

  update(patch: Partial<T>): T {
    this.data = { ...this.data, ...patch };
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
      renameSync(tmp, this.file);
    } catch (error) {
      console.error(`[ultima] failed to write ${this.file}:`, error);
    }
    return this.data;
  }
}
