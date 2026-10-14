import { describe, expect, it } from 'vitest';
import { AudioDocument, mapPosition, shiftMeta, type ChangeEvent } from './document';
import { PeakCache, createColumns } from './peaks';
import { addClip, addTrack, duplicateClip, emptySession, mixRange, moveClip, panGains, sessionLength, splitClip, trimClip, updateTrack, type MtSource } from './multitrack';
import { decodeWavBytes, encodeWavBytes, isWav } from '../wav';

const ramp = (n: number, offset = 0) => Float32Array.from({ length: n }, (_, i) => (i + offset) / 1000);

function makeDoc(n = 100, channels = 2, limits?: { maxSteps?: number; maxBytes?: number }) {
  const doc = new AudioDocument(limits);
  doc.load({ sampleRate: 1000, channels: Array.from({ length: channels }, () => ramp(n)), markers: [], transcript: [] });
  return doc;
}

describe('AudioDocument edits and history', () => {
  it('deletes, inserts and replaces with exact undo/redo', () => {
    const doc = makeDoc(100);
    const original = Array.from(doc.channels[0]);
    doc.replaceRange(10, 20, null, 'Delete');
    expect(doc.length).toBe(90);
    expect(doc.channels[0][10]).toBeCloseTo(0.02, 6);
    doc.replaceRange(5, 5, [new Float32Array(3).fill(9), new Float32Array(3).fill(9)], 'Paste');
    expect(doc.length).toBe(93);
    expect(doc.channels[1][6]).toBe(9);
    doc.replaceRange(0, 2, [Float32Array.from([7, 7]), Float32Array.from([7, 7])], 'Effect');
    expect(doc.channels[0][0]).toBe(7);
    expect(doc.undoLabels).toEqual(['Delete', 'Paste', 'Effect']);
    doc.undo();
    doc.undo();
    doc.undo();
    expect(Array.from(doc.channels[0])).toEqual(original);
    expect(doc.canUndo).toBe(false);
    doc.redo();
    doc.redo();
    doc.redo();
    expect(doc.length).toBe(93);
    expect(doc.channels[0][0]).toBe(7);
    expect(doc.channels[1][6]).toBe(9);
  });

  it('a new edit clears the redo stack', () => {
    const doc = makeDoc(50);
    doc.replaceRange(0, 10, null, 'A');
    doc.undo();
    expect(doc.canRedo).toBe(true);
    doc.replaceRange(0, 5, null, 'B');
    expect(doc.canRedo).toBe(false);
  });

  it('full replacements (channel changes) undo exactly', () => {
    const doc = makeDoc(10, 2);
    const left = doc.channels[0];
    doc.replaceAll([new Float32Array(10).fill(0.5)], 1000, 'Mono');
    expect(doc.channels.length).toBe(1);
    doc.undo();
    expect(doc.channels.length).toBe(2);
    expect(doc.channels[0]).toBe(left);
    doc.redo();
    expect(doc.channels.length).toBe(1);
  });

  it('groups a transaction into one undo step and can roll back', () => {
    const doc = makeDoc(100);
    doc.begin('AI edit');
    doc.replaceRange(0, 10, null, 'x');
    doc.replaceRange(50, 60, [new Float32Array(20), new Float32Array(20)], 'y');
    doc.setMeta({ markers: [{ id: 'm', pos: 5, label: 'M' }] }, 'z');
    doc.commit();
    expect(doc.undoLabels).toEqual(['AI edit']);
    expect(doc.length).toBe(100);
    doc.undo();
    expect(doc.length).toBe(100);
    expect(Array.from(doc.channels[0])).toEqual(Array.from(ramp(100)));
    expect(doc.markers).toEqual([]);
    doc.redo();
    expect(doc.markers.length).toBe(1);
    expect(doc.channels[0][0]).toBeCloseTo(0.01, 6);

    doc.begin('Failing');
    doc.replaceRange(0, 50, null, 'x');
    doc.rollback();
    expect(doc.length).toBe(100);
    expect(doc.undoLabels).toEqual(['AI edit']);
  });

  it('bounds history by steps and bytes', () => {
    const doc = makeDoc(1000, 1, { maxSteps: 3 });
    for (let i = 0; i < 6; i++) doc.replaceRange(0, 10, [new Float32Array(10).fill(i)], `E${i}`);
    expect(doc.undoLabels).toEqual(['E3', 'E4', 'E5']);
    const small = makeDoc(1000, 1, { maxBytes: 3000 });
    for (let i = 0; i < 5; i++) small.replaceRange(0, 400, [new Float32Array(400).fill(i)], `E${i}`);
    // each step stores 400 floats (1600 bytes + overhead): only one fits under 3000 bytes
    expect(small.undoLabels).toEqual(['E4']);
    expect(small.historyBytes).toBeLessThanOrEqual(3000);
  });

  it('tracks the saved state (dirty flag)', () => {
    const doc = makeDoc(100);
    expect(doc.dirty).toBe(false);
    doc.replaceRange(0, 1, null, 'A');
    expect(doc.dirty).toBe(true);
    doc.markSaved();
    expect(doc.dirty).toBe(false);
    doc.undo();
    expect(doc.dirty).toBe(true);
    doc.redo();
    expect(doc.dirty).toBe(false);
  });

  it('shifts markers and transcript with edits and restores them on undo', () => {
    const doc = makeDoc(100);
    doc.setMeta(
      {
        markers: [
          { id: 'a', pos: 5, label: 'before' },
          { id: 'b', pos: 15, label: 'inside' },
          { id: 'c', pos: 40, label: 'after' },
        ],
        transcript: [
          { id: 's1', start: 0, end: 8, text: 'hello' },
          { id: 's2', start: 12, end: 18, text: 'gone' },
          { id: 's3', start: 30, end: 50, text: 'later' },
        ],
      },
      'Meta',
    );
    doc.replaceRange(10, 20, null, 'Delete');
    expect(doc.markers.map((m) => [m.id, m.pos])).toEqual([
      ['a', 5],
      ['c', 30],
    ]);
    expect(doc.transcript.map((s) => [s.id, s.start, s.end])).toEqual([
      ['s1', 0, 8],
      ['s3', 20, 40],
    ]);
    doc.undo();
    expect(doc.markers.map((m) => m.pos)).toEqual([5, 15, 40]);
    expect(doc.transcript.length).toBe(3);
  });

  it('maps positions for scaling edits (speed change)', () => {
    expect(mapPosition(15, 10, 10, 20, 'scale')).toBe(20);
    expect(mapPosition(25, 10, 10, 20, 'scale')).toBe(35);
    expect(mapPosition(5, 10, 10, 20, 'scale')).toBe(5);
    const meta = shiftMeta({ markers: [{ id: 'x', pos: 10, label: '' }], transcript: [] }, 10, 0, 5, 'shift');
    expect(meta.markers[0].pos).toBe(15); // insertion at a marker pushes it right
  });

  it('emits change events with restore state', () => {
    const doc = makeDoc(100);
    const events: ChangeEvent[] = [];
    doc.subscribe((e) => events.push(e));
    doc.replaceRange(10, 20, [new Float32Array(10), new Float32Array(10)], 'Effect', { before: 'sel-before', after: 'sel-after' });
    doc.replaceRange(10, 20, null, 'Cut');
    doc.undo();
    doc.undo();
    doc.redo();
    expect(events.map((e) => e.change.kind)).toEqual(['range', 'splice', 'splice', 'range', 'range']);
    expect(events[3].restore).toBe('sel-before');
    expect(events[4].restore).toBe('sel-after');
  });
});

describe('PeakCache', () => {
  const data = () => [Float32Array.from({ length: 10000 }, (_, i) => Math.sin(i / 50) * (i < 5000 ? 0.5 : 1))];

  it('returns exact min/max per pixel at every zoom', () => {
    const ch = data();
    const cache = new PeakCache();
    cache.reset(ch);
    cache.flush();
    for (const spp of [0.5, 3, 100, 256, 1024, 5000]) {
      const pixels = Math.ceil(10000 / spp);
      const out = createColumns(Math.min(pixels, 2000));
      cache.query(0, 0, spp, out);
      expect(out.valid[0]).toBe(1);
      expect(out.max[0]).toBeGreaterThanOrEqual(out.min[0]);
    }
    const whole = createColumns(1);
    cache.query(0, 0, 10000, whole);
    expect(whole.max[0]).toBeCloseTo(1, 3);
    expect(whole.min[0]).toBeCloseTo(-1, 3);
    const firstHalf = createColumns(1);
    cache.query(0, 0, 4096, firstHalf);
    expect(firstHalf.max[0]).toBeLessThanOrEqual(0.5001);
  });

  it('updates incrementally after edits', () => {
    const doc = new AudioDocument();
    doc.load({ sampleRate: 1000, channels: data(), markers: [], transcript: [] });
    const cache = new PeakCache();
    cache.reset(doc.channels);
    cache.flush();
    doc.subscribe((e) => cache.invalidate(doc.channels, e.change));
    doc.replaceRange(0, 5000, null, 'Delete quiet half');
    expect(cache.dirty).toBe(true);
    cache.flush();
    const out = createColumns(1);
    cache.query(0, 0, 4096, out);
    expect(out.max[0]).toBeGreaterThan(0.9);
    doc.replaceRange(0, 100, [new Float32Array(100).fill(2)], 'Boost');
    cache.flush();
    cache.query(0, 0, 4096, out);
    expect(out.max[0]).toBe(2);
  });
});

describe('multitrack', () => {
  const src = (id: string, value: number, n = 100, channels = 1): MtSource => ({
    id,
    name: id,
    sampleRate: 1000,
    channels: Array.from({ length: channels }, () => new Float32Array(n).fill(value)),
  });

  it('mixes clips with volume, pan, mute and solo', () => {
    let s = addTrack(addTrack(emptySession(1000)));
    const [t1, t2] = s.tracks;
    s = addClip(s, t1.id, { sourceId: 'a', start: 0, offset: 0, length: 100, gainDb: 0, fadeIn: 0, fadeOut: 0 }).session;
    s = addClip(s, t2.id, { sourceId: 'b', start: 50, offset: 0, length: 100, gainDb: 0, fadeIn: 0, fadeOut: 0 }).session;
    const sources = new Map([
      ['a', src('a', 0.25)],
      ['b', src('b', 0.5)],
    ]);
    let mix = mixRange(s, sources, 0, 200);
    expect(mix[0][10]).toBeCloseTo(0.25, 6);
    expect(mix[0][60]).toBeCloseTo(0.75, 6);
    expect(mix[1][160]).toBe(0);
    expect(sessionLength(s)).toBe(150);
    s = updateTrack(s, t2.id, { pan: 1 });
    mix = mixRange(s, sources, 0, 200);
    expect(mix[0][60]).toBeCloseTo(0.25, 6);
    expect(mix[1][60]).toBeCloseTo(0.75, 6);
    s = updateTrack(s, t1.id, { solo: true });
    mix = mixRange(s, sources, 0, 200);
    expect(mix[1][60]).toBeCloseTo(0.25, 6);
    s = updateTrack(s, t1.id, { solo: false, mute: true, volumeDb: 0 });
    s = updateTrack(s, t2.id, { volumeDb: -6.0206, pan: 0 });
    mix = mixRange(s, sources, 0, 200);
    expect(mix[0][10]).toBe(0);
    expect(mix[0][60]).toBeCloseTo(0.25, 4);
  });

  it('pan law keeps unity at the centre', () => {
    expect(panGains(0)).toEqual([1, 1]);
    expect(panGains(-1)).toEqual([1, 0]);
    expect(panGains(0.5)).toEqual([0.5, 1]);
  });

  it('moves, trims, splits and duplicates clips', () => {
    let s = addTrack(addTrack(emptySession(1000)));
    const [t1, t2] = s.tracks;
    const added = addClip(s, t1.id, { sourceId: 'a', start: 100, offset: 0, length: 300, gainDb: 0, fadeIn: 0, fadeOut: 0 });
    s = added.session;
    const id = added.clipId;
    s = moveClip(s, id, 200, t2.id);
    expect(s.tracks[0].clips.length).toBe(0);
    expect(s.tracks[1].clips[0].start).toBe(200);
    s = trimClip(s, id, 'start', 150, 1000); // cannot reveal before the source start
    expect(s.tracks[1].clips[0]).toMatchObject({ start: 200, offset: 0, length: 300 });
    s = trimClip(s, id, 'start', 250, 1000);
    expect(s.tracks[1].clips[0]).toMatchObject({ start: 250, offset: 50, length: 250 });
    s = trimClip(s, id, 'end', 5000, 1000);
    expect(s.tracks[1].clips[0].length).toBe(950); // limited by the source length
    s = splitClip(s, id, 400);
    expect(s.tracks[1].clips.map((c) => [c.start, c.offset, c.length])).toEqual([
      [250, 50, 150],
      [400, 200, 800],
    ]);
    const dup = duplicateClip(s, s.tracks[1].clips[0].id);
    expect(dup.session.tracks[1].clips.length).toBe(3);
  });
});

describe('WAV', () => {
  const signal = () => [Float32Array.from({ length: 1000 }, (_, i) => Math.sin(i / 7) * 0.9), Float32Array.from({ length: 1000 }, (_, i) => Math.cos(i / 11) * -0.7)];

  it('round-trips 16-bit, 24-bit and float', () => {
    for (const [format, tol] of [
      ['pcm16', 1 / 32768],
      ['pcm24', 1 / 8388608],
      ['float32', 1e-7],
    ] as const) {
      const ch = signal();
      const bytes = encodeWavBytes(ch, 44100, { format });
      expect(isWav(bytes)).toBe(true);
      const back = decodeWavBytes(bytes);
      expect(back.sampleRate).toBe(44100);
      expect(back.channels.length).toBe(2);
      expect(back.channels[0].length).toBe(1000);
      for (let i = 0; i < 1000; i += 13) {
        expect(Math.abs(back.channels[0][i] - ch[0][i])).toBeLessThanOrEqual(tol);
        expect(Math.abs(back.channels[1][i] - ch[1][i])).toBeLessThanOrEqual(tol);
      }
    }
  });

  it('clips out-of-range samples for integer formats and dithers 16-bit', () => {
    const back = decodeWavBytes(encodeWavBytes([Float32Array.from([1.5, -2, 0.5])], 8000, { format: 'pcm16' }));
    expect(back.channels[0][0]).toBeCloseTo(32767 / 32768, 6);
    expect(back.channels[0][1]).toBe(-1);
    const dithered = decodeWavBytes(encodeWavBytes([new Float32Array(1000).fill(0.25)], 8000, { format: 'pcm16', dither: true }));
    const mean = dithered.channels[0].reduce((a, b) => a + b, 0) / 1000;
    expect(mean).toBeCloseTo(0.25, 3);
  });

  it('rejects non-WAV data', () => {
    expect(() => decodeWavBytes(new Uint8Array(100))).toThrow();
  });
});
