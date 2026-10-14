import { describe, expect, it } from 'vitest';
import { buildTranscriptPrompt, trimMiddle, withAttachments, TRANSCRIPT_HEADER, TRANSCRIPT_NEW, type TranscriptEntry } from './transcript';

const conv = (n: number, size = 20): TranscriptEntry[] =>
  Array.from({ length: n }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', text: `m${i}:` + 'x'.repeat(size) }));

describe('trimMiddle', () => {
  it('keeps short text', () => {
    expect(trimMiddle('hello', 10)).toBe('hello');
  });
  it('keeps the start and the end within the limit', () => {
    const text = 'A'.repeat(500) + 'B'.repeat(500);
    const out = trimMiddle(text, 200);
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out.startsWith('AAAA')).toBe(true);
    expect(out.endsWith('BBBB')).toBe(true);
    expect(out).toContain('trimmed');
  });
});

describe('buildTranscriptPrompt', () => {
  it('sends just the request when there is no history', () => {
    const r = buildTranscriptPrompt([], 'Hello there');
    expect(r).toEqual({ prompt: 'Hello there', included: 0, omitted: 0, truncated: false });
  });

  it('includes the whole short history, oldest first, with role labels', () => {
    const history: TranscriptEntry[] = [
      { role: 'user', text: 'Hi' },
      { role: 'assistant', text: 'Hello! How can I help?' },
    ];
    const r = buildTranscriptPrompt(history, 'Write a haiku');
    expect(r.included).toBe(2);
    expect(r.omitted).toBe(0);
    expect(r.prompt.startsWith(TRANSCRIPT_HEADER)).toBe(true);
    expect(r.prompt.indexOf('User: Hi')).toBeLessThan(r.prompt.indexOf('Assistant: Hello!'));
    expect(r.prompt.endsWith(`${TRANSCRIPT_NEW}Write a haiku`)).toBe(true);
    expect(r.prompt).not.toContain('not shown');
  });

  it('limits the number of messages', () => {
    const r = buildTranscriptPrompt(conv(10), 'next', { maxMessages: 4 });
    expect(r.included).toBe(4);
    expect(r.omitted).toBe(6);
    expect(r.prompt).toContain('[6 earlier messages not shown]');
    expect(r.prompt).toContain('m9:');
    expect(r.prompt).toContain('m6:');
    expect(r.prompt).not.toContain('m5:');
  });

  it('trims old messages to fit the character budget, keeping the newest', () => {
    const history = conv(50, 1000);
    const budget = 8000;
    const r = buildTranscriptPrompt(history, 'What next?', { maxMessages: 50, charBudget: budget });
    expect(r.prompt.length).toBeLessThanOrEqual(budget);
    expect(r.included).toBeGreaterThan(3);
    expect(r.included).toBeLessThan(10);
    expect(r.omitted).toBe(50 - r.included);
    expect(r.prompt).toContain('m49:');
    expect(r.prompt).not.toContain('m0:');
    expect(r.prompt.endsWith('What next?')).toBe(true);
    // included messages are the most recent ones, in order
    const idx = Array.from({ length: r.included }, (_, k) => r.prompt.indexOf(`m${50 - r.included + k}:`));
    expect(idx.every((v, i) => v > 0 && (i === 0 || v > idx[i - 1]))).toBe(true);
  });

  it('never exceeds the budget for many sizes', () => {
    for (const budget of [1000, 2500, 6000, 20000]) {
      for (const size of [10, 300, 5000]) {
        const r = buildTranscriptPrompt(conv(30, size), 'Q'.repeat(size), { maxMessages: 30, charBudget: budget });
        expect(r.prompt.length, `budget ${budget} size ${size}`).toBeLessThanOrEqual(budget);
      }
    }
  });

  it('shortens a single huge recent message instead of dropping all context', () => {
    const history: TranscriptEntry[] = [{ role: 'user', text: 'write a long story' }, { role: 'assistant', text: 'S'.repeat(20000) + 'THE END' }];
    const r = buildTranscriptPrompt(history, 'make the ending happier', { charBudget: 6000 });
    expect(r.included).toBe(1);
    expect(r.truncated).toBe(true);
    expect(r.prompt).toContain('THE END');
    expect(r.prompt.length).toBeLessThanOrEqual(6000);
  });

  it('trims an oversized request', () => {
    const r = buildTranscriptPrompt([], 'R'.repeat(5000), { charBudget: 1000 });
    expect(r.prompt.length).toBeLessThanOrEqual(1000);
    expect(r.truncated).toBe(true);
  });

  it('skips empty messages (failed replies)', () => {
    const r = buildTranscriptPrompt([{ role: 'user', text: 'hi' }, { role: 'assistant', text: '  ' }], 'again');
    expect(r.included).toBe(1);
    expect(r.prompt).not.toContain('Assistant:');
  });

  it('can disable history', () => {
    const r = buildTranscriptPrompt(conv(4), 'solo', { maxMessages: 0 });
    expect(r.prompt).toBe('solo');
    expect(r.omitted).toBe(4);
  });
});

describe('withAttachments', () => {
  it('inlines text files and mentions images', () => {
    const out = withAttachments('Summarize', [{ kind: 'text', name: 'notes.md', text: '# Notes\nhello' }, { kind: 'image', name: 'a.png' }], { imagesSupported: true });
    expect(out).toContain('Attached file "notes.md":\n"""\n# Notes\nhello\n"""');
    expect(out).toContain('[Attached image: a.png]');
  });
  it('explains when the AI cannot see images', () => {
    const out = withAttachments('What is this?', [{ kind: 'image', name: 'b.jpg' }], { imagesSupported: false });
    expect(out).toContain('cannot see images');
  });
  it('caps each file and the total', () => {
    const big = 'z'.repeat(1000);
    const out = withAttachments('', [
      { kind: 'text', name: 'a.txt', text: big },
      { kind: 'text', name: 'b.txt', text: big },
      { kind: 'text', name: 'c.txt', text: big },
    ], { imagesSupported: false, fileCap: 600, totalCap: 1000 });
    expect(out).toContain('400 more characters');
    expect(out).toContain('"c.txt" left out');
    expect((out.match(/z/g) ?? []).length).toBe(1000);
  });
});
