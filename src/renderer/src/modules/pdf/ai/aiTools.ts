/**
 * AI features of PDF Studio built on runAI / runAIJson (whichever AI the user
 * connected): summary (map-reduce over chunks), "Ask this PDF" (BM25 retrieval with
 * page citations), translation, key data extraction and AI form filling.
 */
import { runAI, runAIJson } from '../../../core/ai/client';
import { stripHtml } from '../../../core/ai/sanitize';
import { coerceFieldValue } from '../forms';
import { chunkPages, joinPagesWithMarkers, selectRelevantPages, type PageText } from '../textsearch';
import type { FieldDef, FieldValue } from '../types';

export type AnswerLanguage = 'auto' | 'en' | 'id' | string;

export function languageRule(lang: AnswerLanguage): string {
  if (lang === 'auto' || !lang) return 'Write in the same language as the document.';
  if (lang === 'en') return 'Write in English.';
  if (lang === 'id') return 'Write in Indonesian (Bahasa Indonesia).';
  return `Write in ${lang}.`;
}

const ANALYST = 'You are a careful document analyst inside a PDF editor. You only use the document text you are given and never invent facts.';

export interface Progress {
  stage: string;
  done: number;
  total: number;
}

/** Map-reduce summary. Calls onText with the final summary while it streams in. */
export async function summarizeDocument(
  pages: PageText[],
  options: { language: AnswerLanguage; signal?: AbortSignal; onProgress?: (p: Progress) => void; onText?: (text: string) => void; chunkChars?: number },
): Promise<string> {
  const size = options.chunkChars ?? 12000;
  const chunks = chunkPages(pages, size);
  if (!chunks.length) throw new Error('This document has no text to summarize (it may be a scan without OCR).');
  const lang = languageRule(options.language);
  const finalPrompt = (body: string, partial: boolean) =>
    [
      partial
        ? 'Below are summaries of consecutive parts of one document. Combine them into one summary of the whole document.'
        : 'Summarize the following document.',
      'Format (Markdown): a one-paragraph overview, then "Key points" as 5-10 bullets, then "Important details" (names, dates, amounts, deadlines, obligations) as bullets when present.',
      'Cite the source pages after facts like [p. 3] using the [Page N] markers.',
      lang,
      '',
      body,
    ].join('\n');
  if (chunks.length === 1) {
    options.onProgress?.({ stage: 'summarize', done: 0, total: 1 });
    const { text } = await runAI({ system: ANALYST, prompt: finalPrompt(chunks[0].text, false), signal: options.signal, onText: options.onText });
    options.onProgress?.({ stage: 'summarize', done: 1, total: 1 });
    return text.trim();
  }
  // map
  let partials: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    options.onProgress?.({ stage: 'map', done: i, total: chunks.length });
    const c = chunks[i];
    const { text } = await runAI({
      system: ANALYST,
      signal: options.signal,
      prompt: [
        `This is part ${i + 1} of ${chunks.length} of a document (pages ${c.firstPage}-${c.lastPage}).`,
        'Summarize it in 5-12 concise bullets. Keep names, numbers, dates and decisions. After each bullet cite its page like [p. N].',
        lang,
        '',
        c.text,
      ].join('\n'),
    });
    partials.push(`Summary of pages ${c.firstPage}-${c.lastPage}:\n${text.trim()}`);
  }
  // reduce (in rounds when the partial summaries are still too long)
  let round = 0;
  while (partials.join('\n\n').length > size * 2 && partials.length > 1 && round < 4) {
    round++;
    const grouped: string[] = [];
    for (let i = 0; i < partials.length; i += 4) {
      const group = partials.slice(i, i + 4).join('\n\n');
      const { text } = await runAI({ system: ANALYST, signal: options.signal, prompt: `Merge these partial summaries into one shorter list of bullets, keeping page citations.\n${lang}\n\n${group}` });
      grouped.push(text.trim());
    }
    partials = grouped;
  }
  options.onProgress?.({ stage: 'reduce', done: chunks.length, total: chunks.length });
  const { text } = await runAI({ system: ANALYST, prompt: finalPrompt(partials.join('\n\n'), true), signal: options.signal, onText: options.onText });
  return text.trim();
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

/** Answers a question about the document, citing pages. */
export async function askDocument(
  pages: PageText[],
  question: string,
  turns: ChatTurn[],
  options: { language: AnswerLanguage; signal?: AbortSignal; onText?: (text: string) => void; maxChars?: number },
): Promise<{ answer: string; pagesUsed: number[]; ranked: boolean }> {
  const { pages: chosen, ranked } = selectRelevantPages(pages, `${question} ${turns.slice(-2).map((t) => t.text).join(' ')}`, options.maxChars ?? 24000);
  const excerpt = joinPagesWithMarkers(chosen, options.maxChars ?? 24000);
  if (!excerpt.trim()) throw new Error('This document has no text the AI can read (it may be a scan without OCR).');
  const history = turns
    .slice(-6)
    .map((t) => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.text}`)
    .join('\n');
  const prompt = [
    ranked ? `DOCUMENT EXCERPTS (the ${chosen.length} most relevant of ${pages.length} pages)` : `DOCUMENT (${pages.length} pages)`,
    excerpt,
    history && `\nCONVERSATION SO FAR\n${history}`,
    `\nQUESTION\n${question}`,
  ]
    .filter(Boolean)
    .join('\n');
  const system = [
    ANALYST,
    'Answer the question using only the document text. Each part of the text starts with a [Page N] marker.',
    'After every statement taken from the document, cite its page like [p. 4] (several pages: [p. 4, 7]).',
    'If the document does not contain the answer, say so plainly. Be concise; use Markdown bullets for lists.',
    options.language === 'auto' ? 'Answer in the language of the question.' : languageRule(options.language),
  ].join('\n');
  const { text } = await runAI({ system, prompt, signal: options.signal, onText: options.onText });
  return { answer: text.trim(), pagesUsed: chosen.map((p) => p.page), ranked };
}

/** Translates text, keeping paragraphs and line breaks. */
export async function translateText(text: string, target: string, options: { signal?: AbortSignal; onText?: (t: string) => void } = {}): Promise<string> {
  if (!text.trim()) throw new Error('This page has no text to translate.');
  const { text: out } = await runAI({
    system: 'You are a professional translator. Translate faithfully and naturally. Keep the paragraph and line structure, numbers, names and formatting. Output only the translation.',
    prompt: `Translate the following text into ${target}.\n\n${text}`,
    signal: options.signal,
    onText: options.onText,
  });
  return out.trim();
}

export interface ExtractedData {
  title: string;
  fields: { name: string; value: string; page: number | null }[];
  tables: { title: string; columns: string[]; rows: string[][] }[];
}

function str(v: unknown, max = 2000): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : JSON.stringify(v);
  return stripHtml(s).slice(0, max);
}

/** Validates/cleans the AI's JSON into ExtractedData (never trusts the shape). */
export function normalizeExtracted(raw: unknown): ExtractedData {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const fields = Array.isArray(obj.fields) ? obj.fields : [];
  const tables = Array.isArray(obj.tables) ? obj.tables : [];
  return {
    title: str(obj.title, 200),
    fields: fields.slice(0, 300).flatMap((f) => {
      if (!f || typeof f !== 'object') return [];
      const r = f as Record<string, unknown>;
      const name = str(r.name ?? r.key ?? r.label, 200);
      if (!name) return [];
      const page = Number(r.page);
      return [{ name, value: str(r.value), page: Number.isFinite(page) && page > 0 ? Math.round(page) : null }];
    }),
    tables: tables.slice(0, 30).flatMap((tb) => {
      if (!tb || typeof tb !== 'object') return [];
      const r = tb as Record<string, unknown>;
      const columns = Array.isArray(r.columns) ? r.columns.slice(0, 50).map((c) => str(c, 200)) : [];
      const rows = Array.isArray(r.rows)
        ? r.rows.slice(0, 2000).map((row) => (Array.isArray(row) ? row.slice(0, 50).map((c) => str(c, 1000)) : [str(row, 1000)]))
        : [];
      if (!columns.length && !rows.length) return [];
      return [{ title: str(r.title ?? r.name, 200), columns, rows }];
    }),
  };
}

export async function extractKeyData(pages: PageText[], focus: string, options: { signal?: AbortSignal; maxChars?: number } = {}): Promise<ExtractedData> {
  const text = joinPagesWithMarkers(pages, options.maxChars ?? 40000);
  if (!text.trim()) throw new Error('This document has no text to analyse.');
  const { data } = await runAIJson<unknown>({
    system: `${ANALYST} You extract structured data.`,
    signal: options.signal,
    prompt: [
      'Extract the key data of this document as JSON with this exact shape:',
      '{"title": string, "fields": [{"name": string, "value": string, "page": number}], "tables": [{"title": string, "columns": [string], "rows": [[string]]}]}',
      '- "fields": important single values (e.g. invoice number, dates, parties, totals, IDs, addresses), in document order, with the page number from the [Page N] markers.',
      '- "tables": every table or list of line items, with header names in "columns" and one array of cell strings per row (same length as columns).',
      '- Copy values exactly as written. Use [] when there is nothing.',
      focus.trim() ? `- Focus on: ${focus.trim()}` : '',
      '',
      text,
    ]
      .filter(Boolean)
      .join('\n'),
  });
  return normalizeExtracted(data);
}

export interface FormSuggestion {
  name: string;
  value: FieldValue;
}

/** Proposes values for form fields from a free-text description of the person/company. */
export async function suggestFormValues(
  defs: FieldDef[],
  current: Record<string, FieldValue>,
  description: string,
  pageText: string,
  options: { signal?: AbortSignal } = {},
): Promise<{ suggestions: FormSuggestion[]; notes: string }> {
  const fillable = defs.filter((d) => !d.readOnly && d.type !== 'button' && d.type !== 'signature').slice(0, 300);
  const fieldList = fillable.map((d) => ({
    name: d.name,
    type: d.type,
    ...(d.options.length ? { options: d.options.slice(0, 60) } : {}),
    ...(d.maxLength ? { maxLength: d.maxLength } : {}),
    current: current[d.name] ?? '',
  }));
  const { data } = await runAIJson<{ values?: Record<string, unknown>; notes?: unknown }>({
    system: `${ANALYST} You fill in PDF forms. Only use information from the user's description; leave a field out when the description does not say it.`,
    signal: options.signal,
    prompt: [
      'Fill in this form. Reply as JSON: {"values": {"<field name>": value}, "notes": string}',
      '- text fields: a string (respect maxLength); checkboxes: true/false; radio buttons and dropdowns: exactly one of the listed options; option lists: an array of options.',
      '- Use the exact field names below. Skip fields you have no information for. Dates in the format the form suggests (else DD/MM/YYYY).',
      '- "notes": a short remark for the user (e.g. which fields were left empty), in the language of the description.',
      '',
      `FIELDS\n${JSON.stringify(fieldList)}`,
      pageText.trim() ? `\nFORM TEXT (labels around the fields)\n${pageText.slice(0, 8000)}` : '',
      `\nDESCRIPTION OF THE PERSON / COMPANY\n${description}`,
    ]
      .filter(Boolean)
      .join('\n'),
  });
  const values = data && typeof data.values === 'object' && data.values ? data.values : {};
  const suggestions: FormSuggestion[] = [];
  for (const [name, raw] of Object.entries(values)) {
    const def = fillable.find((d) => d.name === name) ?? fillable.find((d) => d.name.toLowerCase() === name.toLowerCase());
    if (!def) continue;
    const value = coerceFieldValue(def, raw);
    if (value === null) continue;
    suggestions.push({ name: def.name, value });
  }
  return { suggestions, notes: str(data?.notes, 1000) };
}
