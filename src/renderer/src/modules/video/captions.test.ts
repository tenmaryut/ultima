import { describe, expect, it } from 'vitest';
import { cleanCueText, parseCueTime, parseSrt, parseSubtitles, parseVtt, serializeSrt, serializeVtt, splitLongCues, transcriptText } from './captions';

const SRT = '﻿1\r\n00:00:01,000 --> 00:00:03,500\r\nHello <i>world</i>\r\n\r\n2\r\n00:00:04,000 --> 00:00:06,250\r\nSecond line\r\nwith two lines\r\n\r\n3\r\n00:01:00,000 --> 00:01:02,000\r\n\r\n';

const VTT = `WEBVTT - some title
Kind: captions

NOTE this is a comment
that spans lines

intro
00:01.000 --> 00:03.500 align:start position:10%
<v Roger>Hello &amp; welcome</v>

00:00:04.000 --> 00:00:06.000
Second

STYLE
::cue { color: yellow }
`;

describe('cue times', () => {
  it('parses SRT and VTT timestamps', () => {
    expect(parseCueTime('00:01:02,345')).toBeCloseTo(62.345);
    expect(parseCueTime('01:02.5')).toBeCloseTo(62.5);
    expect(parseCueTime('1:00:00.000')).toBe(3600);
    expect(Number.isNaN(parseCueTime('nope'))).toBe(true);
  });

  it('cleans markup', () => {
    expect(cleanCueText('{\\an8}<b>Bold</b> &lt;3')).toBe('Bold <3');
  });
});

describe('SRT', () => {
  it('parses cues with BOM, CRLF and multi-line text, skipping empty cues', () => {
    const cues = parseSrt(SRT);
    expect(cues).toEqual([
      { start: 1, end: 3.5, text: 'Hello world' },
      { start: 4, end: 6.25, text: 'Second line\nwith two lines' },
    ]);
  });

  it('round-trips', () => {
    const cues = parseSrt(SRT);
    const text = serializeSrt(cues);
    expect(text).toContain('1\n00:00:01,000 --> 00:00:03,500\nHello world');
    expect(parseSrt(text)).toEqual(cues);
  });
});

describe('VTT', () => {
  it('parses cues with ids, settings, notes and styles', () => {
    expect(parseVtt(VTT)).toEqual([
      { start: 1, end: 3.5, text: 'Hello & welcome' },
      { start: 4, end: 6, text: 'Second' },
    ]);
  });

  it('round-trips and detects the format', () => {
    const cues = parseVtt(VTT);
    const text = serializeVtt(cues);
    expect(text.startsWith('WEBVTT\n\n00:00:01.000 --> 00:00:03.500')).toBe(true);
    expect(parseSubtitles(text)).toEqual(cues);
    expect(parseSubtitles(serializeSrt(cues), 'x.srt')).toEqual(cues);
  });

  it('handles a cue right after the header line', () => {
    expect(parseVtt('WEBVTT\n00:00.000 --> 00:01.000\nHi\n')).toEqual([{ start: 0, end: 1, text: 'Hi' }]);
  });
});

describe('helpers', () => {
  it('splits long cues proportionally', () => {
    const out = splitLongCues([{ start: 0, end: 10, text: 'one two three four five six seven eight nine ten' }], 20);
    expect(out.length).toBeGreaterThan(1);
    expect(out[0].start).toBe(0);
    expect(out[out.length - 1].end).toBe(10);
    expect(out.every((c) => c.text.length <= 20)).toBe(true);
    for (let i = 1; i < out.length; i++) expect(out[i].start).toBeCloseTo(out[i - 1].end);
  });

  it('builds a stamped transcript', () => {
    expect(transcriptText([{ start: 65, end: 66, text: 'hi  there' }])).toBe('[1:05] hi there');
  });
});
