/**
 * AI assistant integration: instructions (every action documented), document context,
 * and a validating executor that applies all actions of one reply as one undo step.
 */
import type { HistoryState } from '../../../core/history';
import { t } from '../../../core/i18n';
import { stripHtml } from '../../../core/ai/sanitize';
import type { AIAction, AIContext } from '../../../components/ai/AIAssistantPanel';
import { createText, markupFromRects } from '../annotations/create';
import { engine } from '../engine';
import { searchDocument } from '../find';
import { coerceFieldValue } from '../forms';
import { relativeToPdf } from '../geometry';
import { deletePages, rotatePages } from '../organize';
import { extractToFile } from '../pageActions';
import { parsePageRanges } from '../ranges';
import { usePdfUi } from '../store';
import type { Annot, DocState, FieldDef, OutlineNode } from '../types';

export const PDF_AI_INSTRUCTIONS = `You help the user read and edit the PDF that is open in PDF Studio.
Page numbers are 1-based and refer to the document as it is NOW (before any action of your reply runs).
Positions on a page are relative: x and y go from 0 to 1, measured from the TOP-LEFT corner of the page as the user sees it.

ACTIONS (use only these "type" values):
1. {"type":"goToPage","page":3} — scroll to a page.
2. {"type":"rotatePages","pages":[1,2],"degrees":90} — rotate pages clockwise; degrees is 90, 180 or 270 (-90 = 270). "pages" may also be a range string like "1-3,5" or "all".
3. {"type":"deletePages","pages":[4,5]} — delete pages (at least one page must remain).
4. {"type":"extractPages","pages":[2,3]} — save these pages as a new PDF file (the user picks where to save).
5. {"type":"addText","page":1,"x":0.1,"y":0.05,"text":"Approved by J. Doe","size":12,"color":"#000000"} — add a text box whose top-left corner is at (x, y). size is the font size in points (4-96, default 12); color is #RRGGBB (default #000000). Use \\n for line breaks.
6. {"type":"highlight","text":"payment terms","page":2} — highlight every occurrence of the text (case-insensitive). "page" is optional; without it all pages are searched. Optional "color": #RRGGBB (default yellow).
7. {"type":"fillField","name":"FullName","value":"Budi Santoso"} — fill a form field by its exact name from the context. Checkboxes take true/false; radio buttons and dropdowns take one of the listed options; list boxes take an array.
8. {"type":"setMetadata","title":"...","author":"...","subject":"...","keywords":"a, b"} — change document properties (include only the fields to change).

EXAMPLES
User: "rotate the last two pages and go to page 1" (document has 6 pages)
{"message":"Rotated pages 5 and 6.","actions":[{"type":"rotatePages","pages":[5,6],"degrees":90},{"type":"goToPage","page":1}]}
User: "highlight every mention of 'deadline'"
{"message":"Highlighting every 'deadline'.","actions":[{"type":"highlight","text":"deadline"}]}

For questions about the content, answer from the CURRENT PAGE TEXT in the context (it only contains the current page) and return no actions. For questions about the whole document, suggest the "Ask this PDF" or "Summarize" tools in the AI tab.`;

function outlineTitles(nodes: OutlineNode[], depth = 0, out: string[] = []): string[] {
  for (const n of nodes) {
    if (out.length >= 60) break;
    out.push(`${'  '.repeat(depth)}- ${n.title}${n.srcIndex !== null ? ` (source page ${n.srcIndex + 1})` : ''}`);
    outlineTitles(n.items, depth + 1, out);
  }
  return out;
}

function describeField(d: FieldDef, value: unknown): string {
  const v = Array.isArray(value) ? value.join(', ') : String(value ?? '');
  const opts = d.options.length ? ` options=[${d.options.slice(0, 20).join(' | ')}]` : '';
  return `- "${d.name}" (${d.type}${d.readOnly ? ', read-only' : ''})${opts} = ${JSON.stringify(v.slice(0, 200))}`;
}

export async function buildAIContext(doc: DocState): Promise<AIContext> {
  const ui = usePdfUi.getState();
  const info = ui.docInfo;
  if (!info || !doc.pages.length) return { summary: 'No document is open. The user can open a PDF with File → Open.' };
  const current = Math.min(ui.currentPage, doc.pages.length - 1);
  const entry = doc.pages[current];
  const pageText = (await engine.pageText(entry.src, entry.index)).replace(/\s+\n/g, '\n').trim();
  const presentMain = new Set(doc.pages.filter((p) => p.src === info.mainSrc).map((p) => p.index));
  const fields = info.fieldDefs.filter((d) => d.widgets.some((w) => presentMain.has(w.srcIndex)));
  const pageInfo = engine.info(entry);
  const lines = [
    `File: ${info.name}`,
    `Pages: ${doc.pages.length}. Current page: ${current + 1}.`,
    pageInfo ? `Current page size: ${Math.round(pageInfo.view[2] - pageInfo.view[0])} x ${Math.round(pageInfo.view[3] - pageInfo.view[1])} pt, rotation ${engine.rotation(entry)}°.` : '',
    `Metadata: title=${JSON.stringify(doc.meta.title)}, author=${JSON.stringify(doc.meta.author)}, subject=${JSON.stringify(doc.meta.subject)}, keywords=${JSON.stringify(doc.meta.keywords)}`,
    `Annotations added in this session: ${doc.annots.length}.`,
    info.outline.length ? `Bookmarks:\n${outlineTitles(info.outline).join('\n')}` : 'Bookmarks: none',
    fields.length ? `Form fields (${fields.length}):\n${fields.slice(0, 120).map((d) => describeField(d, doc.fields[d.name])).join('\n')}` : 'Form fields: none',
    `CURRENT PAGE TEXT (page ${current + 1}${pageText.length > 6000 ? ', truncated' : ''}):\n${pageText.slice(0, 6000) || '(no text on this page; it may be a scanned image)'}`,
  ];
  return { summary: lines.filter(Boolean).join('\n') };
}

const HEX = /^#[0-9a-f]{6}$/i;

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Resolves a "pages" value (array of numbers, range string, "all") to page ids of `doc`. */
export function resolvePages(doc: DocState, value: unknown): string[] {
  const total = doc.pages.length;
  let numbers: number[] = [];
  if (Array.isArray(value)) numbers = value.map((v) => num(v)).filter((n): n is number => n !== null).map((n) => Math.round(n));
  else if (typeof value === 'number') numbers = [Math.round(value)];
  else if (typeof value === 'string') numbers = parsePageRanges(value, total).pages;
  return [...new Set(numbers.filter((n) => n >= 1 && n <= total))].map((n) => doc.pages[n - 1].id);
}

export async function applyAIActions(actions: AIAction[], history: HistoryState<DocState>): Promise<string> {
  const start = history.present;
  if (!start.pages.length) throw new Error(t('Open a PDF first.'));
  const ui = usePdfUi.getState();
  const info = ui.docInfo;
  let doc = start;
  const done: string[] = [];
  const skipped: string[] = [];
  let goTo: string | null = null;
  const extracts: string[][] = [];
  const pageOf = (n: unknown) => {
    const p = num(n);
    if (p === null) return null;
    return start.pages[Math.round(p) - 1] ?? null;
  };

  for (const action of actions.slice(0, 50)) {
    switch (action.type) {
      case 'goToPage': {
        const p = pageOf(action.page);
        if (p) goTo = p.id;
        else skipped.push('goToPage');
        break;
      }
      case 'rotatePages': {
        const ids = resolvePages(start, action.pages);
        const deg = num(action.degrees);
        if (!ids.length || deg === null || Math.round(deg) % 90 !== 0) {
          skipped.push('rotatePages');
          break;
        }
        doc = { ...doc, pages: rotatePages(doc.pages, ids, Math.round(deg)) };
        done.push(t('rotated {count} page(s)', { count: ids.length }));
        break;
      }
      case 'deletePages': {
        const ids = resolvePages(start, action.pages).filter((id) => doc.pages.some((p) => p.id === id));
        if (!ids.length || ids.length >= doc.pages.length) {
          skipped.push('deletePages');
          break;
        }
        doc = deletePages(doc, ids);
        done.push(t('deleted {count} page(s)', { count: ids.length }));
        break;
      }
      case 'extractPages': {
        const ids = resolvePages(start, action.pages);
        if (ids.length) extracts.push(ids);
        else skipped.push('extractPages');
        break;
      }
      case 'addText': {
        const p = pageOf(action.page);
        const text = typeof action.text === 'string' ? stripHtml(action.text).slice(0, 5000) : '';
        const info = p ? engine.info(p) : undefined;
        if (!p || !info || !text.trim() || !doc.pages.some((x) => x.id === p.id)) {
          skipped.push('addText');
          break;
        }
        const x = Math.min(0.98, Math.max(0, num(action.x) ?? 0.1));
        const y = Math.min(0.98, Math.max(0, num(action.y) ?? 0.1));
        const size = Math.min(96, Math.max(4, num(action.size) ?? 12));
        const color = typeof action.color === 'string' && HEX.test(action.color) ? action.color : '#000000';
        const rot = engine.rotation(p, ui.viewRotation);
        const origin = relativeToPdf(info.view, rot, x, y);
        const a = createText({ ...ui.style, fontSize: size, textColor: color }, p.id, origin, rot, text);
        doc = { ...doc, annots: [...doc.annots, a] };
        done.push(t('added text'));
        break;
      }
      case 'highlight': {
        const text = typeof action.text === 'string' ? action.text.trim().slice(0, 300) : '';
        if (!text) {
          skipped.push('highlight');
          break;
        }
        const p = action.page !== undefined ? pageOf(action.page) : null;
        const pages = (p ? [p] : doc.pages).filter((x) => doc.pages.some((y) => y.id === x.id));
        const matches = await searchDocument(pages, text, {}, undefined, undefined, 300);
        const color = typeof action.color === 'string' && HEX.test(action.color) ? action.color : ui.style.highlightColor;
        const created: Annot[] = matches.filter((m) => m.rects.length).map((m) => markupFromRects('highlight', { ...ui.style, highlightColor: color }, m.page, m.rects));
        doc = { ...doc, annots: [...doc.annots, ...created] };
        done.push(created.length ? t('highlighted {count} match(es)', { count: created.length }) : t('no matches for "{text}"', { text }));
        break;
      }
      case 'fillField': {
        const name = typeof action.name === 'string' ? action.name : '';
        const def = info?.fieldDefs.find((d) => d.name === name) ?? info?.fieldDefs.find((d) => d.name.toLowerCase() === name.toLowerCase());
        const value = def && !def.readOnly ? coerceFieldValue(def, action.value) : null;
        if (!def || value === null) {
          skipped.push(`fillField ${name}`.trim());
          break;
        }
        doc = { ...doc, fields: { ...doc.fields, [def.name]: value } };
        done.push(t('filled "{name}"', { name: def.name }));
        break;
      }
      case 'setMetadata': {
        const meta = { ...doc.meta };
        let changed = 0;
        for (const key of ['title', 'author', 'subject', 'keywords', 'creator'] as const) {
          const v = action[key];
          if (typeof v === 'string') {
            meta[key] = stripHtml(v).slice(0, 500);
            changed++;
          }
        }
        if (changed) {
          doc = { ...doc, meta };
          done.push(t('updated document properties'));
        } else skipped.push('setMetadata');
        break;
      }
      default:
        skipped.push(String(action.type));
    }
  }

  if (doc !== start) history.set(doc, { label: 'AI edit' });
  if (goTo) {
    const index = doc.pages.findIndex((p) => p.id === goTo);
    if (index >= 0) usePdfUi.getState().goToPage(index);
    done.push(t('went to page {n}', { n: index + 1 }));
  }
  for (const ids of extracts) {
    const alive = ids.filter((id) => doc.pages.some((p) => p.id === id));
    if (alive.length) {
      await extractToFile(history, alive);
      done.push(t('extracted {count} page(s)', { count: alive.length }));
    }
  }
  const summary = done.length ? done.join(', ') : t('Nothing was changed');
  return skipped.length ? `${summary} · ${t('skipped')}: ${skipped.join(', ')}` : summary;
}
