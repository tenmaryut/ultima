import { describe, expect, it } from 'vitest';
import { chaptersText, deletedWordRuns, planTranscriptCut, snapToQuiet, transcriptToSrt, transcriptToText, transcriptToVtt, wordTimes } from './transcriptEdit';

describe('edit by transcript', () => {
  it('finds deleted word runs, ignoring case and punctuation', () => {
    const r = deletedWordRuns('So, um, I think we should, uh, start now.', 'So I think we should start now');
    expect(r.runs).toEqual([
      [1, 1],
      [6, 6],
    ]);
    expect(r.inserted).toBe(false);
    expect(deletedWordRuns('hello world', 'hello brave world').inserted).toBe(true);
    expect(deletedWordRuns('a b c', '').runs).toEqual([[0, 2]]);
  });

  it('estimates word times proportionally and plans cuts', () => {
    const times = wordTimes('aa bb', 0, 6);
    expect(times).toEqual([
      { start: 0, end: 3 },
      { start: 3, end: 6 },
    ]);
    const plan = planTranscriptCut('one two three four', 'one four', 10, 30);
    expect(plan.ranges.length).toBe(1);
    expect(plan.ranges[0].start).toBeGreaterThan(10);
    expect(plan.ranges[0].end).toBeLessThan(30);
    const whole = planTranscriptCut('drop everything here', '', 100, 200);
    expect(whole.ranges).toEqual([{ start: 100, end: 200 }]);
  });

  it('snaps cut points to the quietest nearby moment', () => {
    const sr = 1000;
    const data = new Float32Array(1000).fill(0.5);
    for (let i = 480; i < 500; i++) data[i] = 0;
    const snapped = snapToQuiet([data], 450, 80, sr);
    expect(snapped).toBeGreaterThanOrEqual(480);
    expect(snapped).toBeLessThan(500);
  });
});

describe('transcript export', () => {
  const segs = [
    { start: 0, end: 1.5, text: 'Hello  there' },
    { start: 61.25, end: 63, text: 'General Kenobi' },
  ];
  it('formats SRT, VTT and text', () => {
    expect(transcriptToSrt(segs)).toBe('1\n00:00:00,000 --> 00:00:01,500\nHello there\n\n2\n00:01:01,250 --> 00:01:03,000\nGeneral Kenobi\n');
    expect(transcriptToVtt(segs).startsWith('WEBVTT\n\n00:00:00.000 --> 00:00:01.500')).toBe(true);
    expect(transcriptToText(segs, true)).toBe('[00:00:00] Hello there\n[00:01:01] General Kenobi');
  });

  it('formats chapters starting at 0:00', () => {
    expect(chaptersText([{ time: 75, label: 'Topic' }], 'Start')).toBe('00:00 Start\n01:15 Topic');
    expect(chaptersText([{ time: 3700, label: 'Late' }, { time: 0, label: 'Begin' }])).toBe('00:00 Begin\n1:01:40 Late');
  });
});
