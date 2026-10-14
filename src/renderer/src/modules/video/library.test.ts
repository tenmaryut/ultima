import { describe, expect, it } from 'vitest';
import { LIBRARY, SFX, findLibraryItem, isLibraryMedia, libraryItemOf, libraryMediaId, libraryMediaRef, renderSfx, sfxWav } from './library';
import { applyAIActions } from './ai/executor';
import { describeProject } from './ai/describe';
import { addMediaToTimeline, clipEnd, createProject, getTrack, tracksOfKind } from './model';
import { parseProject, serializeProject } from './project';
import type { MediaRef, Project } from './types';

describe('built-in sounds', () => {
  it('renders every sound the same way each time, loud enough and without clipping', () => {
    for (const item of SFX) {
      const a = renderSfx(item);
      expect(a.length).toBe(Math.round(item.duration! * 48000));
      expect(renderSfx(item)).toEqual(a);
      let peak = 0;
      let energy = 0;
      for (const v of a) {
        peak = Math.max(peak, Math.abs(v));
        energy += v * v;
      }
      expect(peak).toBeLessThanOrEqual(0.9);
      expect(peak).toBeGreaterThan(0.5);
      expect(energy / a.length).toBeGreaterThan(1e-5);
      // no click at the ends
      expect(Math.abs(a[0])).toBeLessThan(0.01);
      expect(Math.abs(a[a.length - 1])).toBeLessThan(0.01);
    }
  });

  it('writes a WAV file that matches its media reference', () => {
    const item = SFX.find((s) => s.id === 'pop')!;
    const wav = sfxWav(item);
    const ref = libraryMediaRef(item);
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe('RIFF');
    expect(wav.length).toBe(ref.size);
    expect(ref).toMatchObject({ kind: 'audio', name: 'Pop.wav', duration: item.duration });
  });
});

describe('finding library items', () => {
  it('finds items by id, name or a common other name', () => {
    expect(findLibraryItem('whoosh')?.id).toBe('whoosh');
    expect(findLibraryItem('Swoosh', ['sfx'])?.id).toBe('whoosh');
    expect(findLibraryItem('Camera shutter')?.id).toBe('shutter');
    expect(findLibraryItem('explosion', ['sfx'])?.id).toBe('boom');
    expect(findLibraryItem('light leak', ['overlay'])?.id).toBe('lightLeak');
    expect(findLibraryItem('whoosh', ['sticker'])).toBeUndefined();
    expect(findLibraryItem('nonsense')).toBeUndefined();
    const ids = LIBRARY.map(libraryMediaId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every(isLibraryMedia)).toBe(true);
    expect(libraryItemOf('lib_sticker_heart')?.label).toBe('Heart');
  });
});

describe('the AI and the library', () => {
  const clipMedia: MediaRef = { id: 'm_v', name: 'game.mp4', kind: 'video', duration: 10, width: 1080, height: 1920, size: 1, mime: 'video/mp4', hasAudio: true };
  const project = (): Project => addMediaToTimeline({ ...createProject({ width: 1080, height: 1920 }), media: [clipMedia] }, clipMedia, { start: 0, duration: 10 }).project;
  const run = (p: Project, actions: unknown[]) => applyAIActions(p, actions, { playhead: 1 });

  it('adds a sound effect at several times on a free audio track', () => {
    const r = run(project(), [{ type: 'addSfx', sound: 'swoosh', times: [2, 5, 8], volume: -4 }]);
    const sfx = r.project.clips.filter((c) => c.mediaId === 'lib_sfx_whoosh');
    expect(sfx.map((c) => c.start)).toEqual([2, 5, 8]);
    expect(sfx.every((c) => c.volume === -4 && getTrack(r.project, c.trackId)?.name !== 'A1')).toBe(true);
    expect(r.project.media.filter((m) => m.id === 'lib_sfx_whoosh')).toHaveLength(1);
    expect(describeProject(r.project, { playhead: 0, selection: [] })).toContain('lib_sfx_whoosh | audio "Whoosh.wav"');
    expect(run(project(), [{ type: 'addSfx', sound: 'kazoo' }]).results[0].detail).toContain('unknown sound kazoo');
  });

  it('adds stickers where asked and overlays over the whole (vertical) frame', () => {
    const r = run(project(), [
      { type: 'addGraphic', graphic: 'hitMarker', start: 3, duration: 0.3, position: 'center', scale: 0.2 },
      { type: 'addGraphic', graphic: 'lightLeak', duration: 'full' },
    ]);
    const marker = r.project.clips.find((c) => c.mediaId === 'lib_sticker_hitMarker')!;
    expect([marker.start, marker.duration, marker.visual!.scale, marker.visual!.x]).toEqual([3, 0.3, 0.2, 0]);
    const leak = r.project.clips.find((c) => c.mediaId === 'lib_overlay_lightLeak')!;
    expect(leak.blend).toBe('screen');
    // a 16:9 overlay covers a 9:16 frame
    expect(leak.visual!.scale).toBeCloseTo((16 / 9) * (16 / 9), 3);
    expect(clipEnd(leak)).toBe(10);
    const order = tracksOfKind(r.project, 'video').map((t) => t.id);
    expect(order.indexOf(leak.trackId)).toBeGreaterThan(order.indexOf(marker.trackId));
  });

  it('asks the user for files', () => {
    const r = run(project(), [{ type: 'requestImport', what: 'music', message: 'Pick the song for the montage' }]);
    expect(r.effects).toEqual([{ kind: 'requestImport', what: 'music', message: 'Pick the song for the montage' }]);
    expect(r.results[0].ok).toBe(true);
  });
});

describe('fonts in project files', () => {
  it('keeps imported fonts and drops broken ones', () => {
    const p = { ...createProject(), fonts: [{ id: 'font_1', family: 'My Font', name: 'MyFont.ttf', data: 'AAEAAA==' }] };
    const raw = JSON.parse(serializeProject(p));
    raw.fonts.push({ id: 'font_2', family: 'Bad', name: 'x', data: 'not base64!' }, { id: 'font_3', family: '"; }', name: 'y', data: 'AAAA' });
    expect(parseProject(raw).fonts).toEqual(p.fonts);
  });
});
