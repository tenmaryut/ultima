/**
 * Text utilities for the AI features (pure, unit tested): tokenizing, BM25 ranking of
 * pages for "Ask this PDF", and chunking long documents (with page markers) for the
 * map-reduce summary.
 */

const STOPWORDS = new Set(
  (
    // English
    'a an and are as at be but by for from has have he her his i if in into is it its of on or our she so that the their them ' +
    'then there these they this to was we were what when where which who will with you your not no can do does did been ' +
    'about also any all more most other some such than too very just only over under again further how why each both ' +
    // Indonesian
    'yang dan di ke dari ini itu untuk dengan pada adalah atau juga akan oleh dalam tidak ada sebagai bisa telah sudah ' +
    'karena saat agar maka para kami kita mereka dia ia anda saya apa siapa bagaimana mengapa kapan dimana'
  ).split(/\s+/),
);

/** Lowercase word tokens without diacritics and stopwords. Numbers are kept. */
export function tokenize(text: string): string[] {
  const normalized = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  const tokens = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  return tokens.filter((tok) => (tok.length > 1 || /\d/.test(tok)) && !STOPWORDS.has(tok));
}

export interface BM25Index {
  docs: Map<string, number>[];
  lengths: number[];
  avgLength: number;
  df: Map<string, number>;
  k1: number;
  b: number;
}

export function buildBM25(documents: string[], k1 = 1.4, b = 0.75): BM25Index {
  const docs: Map<string, number>[] = [];
  const lengths: number[] = [];
  const df = new Map<string, number>();
  for (const text of documents) {
    const tf = new Map<string, number>();
    const tokens = tokenize(text);
    for (const tok of tokens) tf.set(tok, (tf.get(tok) ?? 0) + 1);
    for (const tok of tf.keys()) df.set(tok, (df.get(tok) ?? 0) + 1);
    docs.push(tf);
    lengths.push(tokens.length);
  }
  const avgLength = lengths.length ? lengths.reduce((s, n) => s + n, 0) / lengths.length : 0;
  return { docs, lengths, avgLength, df, k1, b };
}

/** BM25 score of every document for the query (same order as the indexed documents). */
export function scoreBM25(index: BM25Index, query: string): number[] {
  const terms = [...new Set(tokenize(query))];
  const n = index.docs.length;
  return index.docs.map((tf, i) => {
    let score = 0;
    const len = index.lengths[i];
    for (const term of terms) {
      const f = tf.get(term) ?? 0;
      if (!f) continue;
      const df = index.df.get(term) ?? 0;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      const norm = index.k1 * (1 - index.b + index.b * (index.avgLength ? len / index.avgLength : 1));
      score += idf * ((f * (index.k1 + 1)) / (f + norm));
    }
    return score;
  });
}

/** Indices of the `k` best documents (score > 0), best first. Ties keep document order. */
export function topK(scores: number[], k: number): number[] {
  return scores
    .map((score, index) => ({ score, index }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, k)
    .map((s) => s.index);
}

export interface PageText {
  /** 1-based page number as shown to the user. */
  page: number;
  text: string;
}

export interface TextChunk {
  text: string;
  firstPage: number;
  lastPage: number;
}

/** Collapses runs of spaces and blank lines (keeps paragraph breaks). */
export function cleanText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function pageMarker(page: number): string {
  return `[Page ${page}]`;
}

/** Splits text into pieces of at most `max` chars, preferring paragraph, line, sentence, then word breaks. */
export function splitLongText(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    let cut = -1;
    for (const sep of ['\n\n', '\n', '. ', '? ', '! ', '; ', ', ', ' ']) {
      const at = window.lastIndexOf(sep);
      if (at > max * 0.5) {
        cut = at + sep.length;
        break;
      }
    }
    if (cut <= 0) cut = max;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut);
  }
  if (rest.trim()) out.push(rest.trim());
  return out.filter(Boolean);
}

/**
 * Groups page texts into chunks of at most `maxChars` characters. Every page starts with
 * a "[Page N]" marker so the AI can cite page numbers. Pages longer than a chunk are
 * split (each part repeats the marker).
 */
export function chunkPages(pages: PageText[], maxChars = 12000): TextChunk[] {
  const chunks: TextChunk[] = [];
  let current: TextChunk | null = null;
  const flush = () => {
    if (current && current.text.trim()) chunks.push(current);
    current = null;
  };
  for (const { page, text } of pages) {
    const clean = cleanText(text);
    if (!clean) continue;
    const marker = pageMarker(page);
    const budget = Math.max(200, maxChars - marker.length - 2);
    for (const part of splitLongText(clean, budget)) {
      const block = `${marker}\n${part}`;
      if (current && current.text.length + 2 + block.length <= maxChars) {
        current.text += `\n\n${block}`;
        current.lastPage = page;
      } else {
        flush();
        current = { text: block, firstPage: page, lastPage: page };
      }
    }
  }
  flush();
  return chunks;
}

/** Joins page texts with markers, cut to `maxChars` (with a note when truncated). */
export function joinPagesWithMarkers(pages: PageText[], maxChars: number): string {
  let out = '';
  for (const { page, text } of pages) {
    const clean = cleanText(text);
    if (!clean) continue;
    const block = `${pageMarker(page)}\n${clean}\n\n`;
    if (out.length + block.length > maxChars) {
      const room = maxChars - out.length;
      if (room > 200) out += `${block.slice(0, room)}…\n`;
      out += '[…document truncated…]';
      return out.trim();
    }
    out += block;
  }
  return out.trim();
}

/**
 * Picks the pages most relevant to a question for "Ask this PDF". Short documents are
 * returned whole; long ones are ranked with BM25 (plus the first page for context) and
 * returned in document order until `maxChars` is filled.
 */
export function selectRelevantPages(pages: PageText[], question: string, maxChars = 24000): { pages: PageText[]; ranked: boolean } {
  const total = pages.reduce((s, p) => s + cleanText(p.text).length + 12, 0);
  if (total <= maxChars) return { pages, ranked: false };
  const index = buildBM25(pages.map((p) => p.text));
  const scores = scoreBM25(index, question);
  const order = topK(scores, pages.length);
  const chosen = new Set<number>();
  let used = 0;
  const tryAdd = (i: number) => {
    if (chosen.has(i)) return;
    const len = cleanText(pages[i].text).length + 12;
    if (used + len > maxChars && chosen.size > 0) return;
    chosen.add(i);
    used += len;
  };
  if (pages.length) tryAdd(0);
  for (const i of order) {
    tryAdd(i);
    // neighbours often continue the answer
    if (i + 1 < pages.length) tryAdd(i + 1);
    if (used >= maxChars) break;
  }
  if (chosen.size <= 1 && pages.length > 1) {
    // no keyword overlap: fall back to the beginning of the document
    for (let i = 1; i < pages.length && used < maxChars; i++) tryAdd(i);
  }
  return { pages: [...chosen].sort((a, b) => a - b).map((i) => pages[i]), ranked: true };
}

/** Finds page citations like "[p. 3]", "[Page 3]", "(p. 3–4)", "page 12" in an AI answer. */
export function findCitations(text: string): { index: number; length: number; pages: number[] }[] {
  const out: { index: number; length: number; pages: number[] }[] = [];
  const re = /[[(]?\b(?:pages?|pp?\.|hal(?:aman)?\.?)\s*(\d{1,5})(?:\s*[-–]\s*(\d{1,5}))?[\])]?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const a = parseInt(m[1], 10);
    const b = m[2] ? parseInt(m[2], 10) : a;
    const pages: number[] = [];
    for (let p = Math.min(a, b); p <= Math.max(a, b) && pages.length < 50; p++) pages.push(p);
    out.push({ index: m.index, length: m[0].length, pages });
  }
  return out;
}

/** CSV with RFC 4180 quoting. */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const s = cell === null || cell === undefined ? '' : String(cell);
          return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(','),
    )
    .join('\r\n');
}
