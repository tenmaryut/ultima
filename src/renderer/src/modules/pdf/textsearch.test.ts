import { describe, expect, it } from 'vitest';
import {
  buildBM25,
  chunkPages,
  cleanText,
  findCitations,
  joinPagesWithMarkers,
  scoreBM25,
  selectRelevantPages,
  splitLongText,
  toCsv,
  tokenize,
  topK,
} from './textsearch';

describe('tokenize', () => {
  it('lowercases, strips diacritics and stopwords', () => {
    expect(tokenize('The Café and the Invoice No. 42')).toEqual(['cafe', 'invoice', '42']);
    expect(tokenize('Dokumen ini adalah kontrak yang sah')).toEqual(['dokumen', 'kontrak', 'sah']);
  });
});

describe('BM25', () => {
  const docs = [
    'The payment is due within thirty days of the invoice date.',
    'Termination: either party may terminate this agreement with notice.',
    'The invoice total includes tax. Invoice number 2024-17.',
    'Nothing relevant here at all.',
  ];
  const index = buildBM25(docs);
  it('ranks documents containing the query terms first', () => {
    const scores = scoreBM25(index, 'invoice');
    expect(topK(scores, 2)).toEqual([2, 0]);
    expect(scores[3]).toBe(0);
  });
  it('prefers rarer terms (idf) and multiple matches', () => {
    const scores = scoreBM25(index, 'terminate agreement');
    expect(topK(scores, 1)).toEqual([1]);
  });
  it('returns zeros for unknown terms', () => {
    expect(scoreBM25(index, 'zebra').every((s) => s === 0)).toBe(true);
    expect(topK(scoreBM25(index, 'zebra'), 3)).toEqual([]);
  });
  it('normalizes by document length', () => {
    const idx = buildBM25(['apple', `apple ${'filler '.repeat(200)}`]);
    const s = scoreBM25(idx, 'apple');
    expect(s[0]).toBeGreaterThan(s[1]);
  });
});

describe('chunking', () => {
  it('keeps page markers and respects the chunk size', () => {
    const pages = Array.from({ length: 10 }, (_, i) => ({ page: i + 1, text: `Page text ${i + 1}. `.repeat(100) }));
    const chunks = chunkPages(pages, 5000);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(5000);
      expect(c.text.startsWith('[Page ')).toBe(true);
    }
    expect(chunks[0].firstPage).toBe(1);
    expect(chunks[chunks.length - 1].lastPage).toBe(10);
    const all = chunks.map((c) => c.text).join('\n');
    for (let p = 1; p <= 10; p++) expect(all).toContain(`[Page ${p}]`);
  });
  it('splits a very long page and repeats its marker', () => {
    const chunks = chunkPages([{ page: 3, text: 'word '.repeat(5000) }], 4000);
    expect(chunks.length).toBeGreaterThan(5);
    expect(chunks.every((c) => c.text.startsWith('[Page 3]'))).toBe(true);
    expect(chunks.every((c) => c.text.length <= 4000)).toBe(true);
  });
  it('skips empty pages', () => {
    expect(chunkPages([{ page: 1, text: '   ' }, { page: 2, text: 'Hello' }], 100)).toEqual([{ text: '[Page 2]\nHello', firstPage: 2, lastPage: 2 }]);
  });
  it('splits on natural boundaries', () => {
    const parts = splitLongText('First sentence here. Second sentence follows. Third one.', 30);
    expect(parts[0]).toBe('First sentence here.');
    expect(parts.join(' ').replace(/\s+/g, ' ')).toBe('First sentence here. Second sentence follows. Third one.');
  });
  it('cleans whitespace', () => {
    expect(cleanText('a  \t b\r\n\n\n\nc ')).toBe('a b\n\nc');
  });
  it('joins pages with markers and truncates', () => {
    const text = joinPagesWithMarkers([{ page: 1, text: 'Alpha' }, { page: 2, text: 'Beta' }], 1000);
    expect(text).toBe('[Page 1]\nAlpha\n\n[Page 2]\nBeta');
    const cut = joinPagesWithMarkers([{ page: 1, text: 'x'.repeat(5000) }], 1000);
    expect(cut.length).toBeLessThan(1100);
    expect(cut).toContain('truncated');
  });
});

describe('retrieval for Ask this PDF', () => {
  it('returns short documents whole', () => {
    const pages = [{ page: 1, text: 'short' }, { page: 2, text: 'doc' }];
    expect(selectRelevantPages(pages, 'anything', 1000)).toEqual({ pages, ranked: false });
  });
  it('selects relevant pages of long documents in page order', () => {
    const pages = Array.from({ length: 40 }, (_, i) => ({ page: i + 1, text: `${'lorem ipsum dolor '.repeat(60)} ${i === 25 ? 'The warranty period is 24 months.' : ''}` }));
    const res = selectRelevantPages(pages, 'How long is the warranty period?', 6000);
    expect(res.ranked).toBe(true);
    const nums = res.pages.map((p) => p.page);
    expect(nums).toContain(26);
    expect(nums).toContain(1);
    expect([...nums].sort((a, b) => a - b)).toEqual(nums);
  });
});

describe('citations and CSV', () => {
  it('finds page citations', () => {
    const c = findCitations('See [Page 3] and (p. 5-6), also page 12.');
    expect(c.map((x) => x.pages)).toEqual([[3], [5, 6], [12]]);
  });
  it('quotes CSV cells', () => {
    expect(toCsv([['a', 'b,c'], ['he said "hi"', 3]])).toBe('a,"b,c"\r\n"he said ""hi""",3');
  });
});
