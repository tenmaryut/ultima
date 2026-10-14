/**
 * Safe renderer for AI answers with clickable page citations ("[p. 3]" → jump to page 3).
 * Never injects HTML: paragraphs, bullets and **bold** become React elements.
 */
import { Fragment, type ReactNode } from 'react';
import { findCitations } from '../textsearch';
import { usePdfUi } from '../store';

function inline(text: string, keyBase: string, pageCount: number): ReactNode[] {
  const out: ReactNode[] = [];
  const cites = findCitations(text);
  let last = 0;
  let k = 0;
  const pushBold = (s: string) => {
    const parts = s.split(/(\*\*[^*]+\*\*)/g);
    for (const part of parts) {
      if (!part) continue;
      if (part.startsWith('**') && part.endsWith('**') && part.length > 4) out.push(<strong key={`${keyBase}-b${k++}`}>{part.slice(2, -2)}</strong>);
      else out.push(part);
    }
  };
  for (const c of cites) {
    if (c.index > last) pushBold(text.slice(last, c.index));
    const valid = c.pages.filter((p) => p >= 1 && p <= pageCount);
    if (valid.length) {
      out.push(
        <button
          key={`${keyBase}-c${k++}`}
          type="button"
          className="pd-cite"
          title={`→ ${valid.join(', ')}`}
          onClick={() => {
            const ui = usePdfUi.getState();
            ui.set({ mode: 'view' });
            ui.goToPage(valid[0] - 1);
          }}
        >
          {valid.length > 1 ? `p. ${valid[0]}–${valid[valid.length - 1]}` : `p. ${valid[0]}`}
        </button>,
      );
    } else out.push(text.slice(c.index, c.index + c.length));
    last = c.index + c.length;
  }
  if (last < text.length) pushBold(text.slice(last));
  return out;
}

export function CitedText({ text, pageCount }: { text: string; pageCount: number }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*•]|\d+[.)])\s+/, ''));
      blocks.push(
        <ul key={key++}>
          {items.map((it, j) => (
            <li key={j}>{inline(it, `l${key}-${j}`, pageCount)}</li>
          ))}
        </ul>,
      );
      continue;
    }
    const heading = /^#{1,4}\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push(
        <p key={key++} style={{ fontWeight: 700 }}>
          {inline(heading[1], `h${key}`, pageCount)}
        </p>,
      );
      i++;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^\s*([-*•]|\d+[.)])\s+/.test(lines[i]) && !/^#{1,4}\s+/.test(lines[i])) para.push(lines[i++]);
    blocks.push(
      <p key={key++}>
        {para.map((p, j) => (
          <Fragment key={j}>
            {j > 0 && <br />}
            {inline(p, `p${key}-${j}`, pageCount)}
          </Fragment>
        ))}
      </p>,
    );
  }
  return <div>{blocks}</div>;
}
