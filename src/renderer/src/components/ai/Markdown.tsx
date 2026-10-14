import { Fragment, type ReactNode } from 'react';
import { openExternal } from '../../core/platform';

/**
 * Tiny, safe markdown renderer for AI answers. It never injects HTML: everything is
 * turned into React elements. Supports paragraphs, headings, lists, code fences,
 * inline code, bold, italics and links.
 */
export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim().startsWith('```')) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) code.push(lines[i++]);
      i++;
      blocks.push(
        <pre key={key++} className="code-block">
          {code.join('\n')}
        </pre>,
      );
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push(
        <p key={key++} style={{ fontWeight: 700, color: 'var(--text-0)' }}>
          {inline(heading[2])}
        </p>,
      );
      i++;
      continue;
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*•]|\d+[.)])\s+/, ''));
        i++;
      }
      const ListTag = ordered ? 'ol' : 'ul';
      blocks.push(
        <ListTag key={key++} style={{ margin: '0 0 6px', paddingLeft: 18 }}>
          {items.map((item, j) => (
            <li key={j}>{inline(item)}</li>
          ))}
        </ListTag>,
      );
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !lines[i].trim().startsWith('```') && !/^(#{1,4})\s+/.test(lines[i]) && !/^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) {
      para.push(lines[i++]);
    }
    blocks.push(<p key={key++}>{para.map((p, j) => <Fragment key={j}>{j > 0 && <br />}{inline(p)}</Fragment>)}</p>);
  }
  return <div>{blocks}</div>;
}

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\[[^\]]+\]\((https?:\/\/[^)\s]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const token = m[0];
    if (m[1]) out.push(<code key={k++} className="mono" style={{ background: 'var(--bg-0)', padding: '0 4px', borderRadius: 3 }}>{token.slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={k++}>{token.slice(2, -2)}</strong>);
    else if (m[3]) out.push(<em key={k++}>{token.slice(1, -1)}</em>);
    else if (m[4]) {
      const label = /\[([^\]]+)\]/.exec(token)?.[1] ?? token;
      const url = m[5];
      out.push(
        <a
          key={k++}
          href={url}
          onClick={(e) => {
            e.preventDefault();
            openExternal(url);
          }}
        >
          {label}
        </a>,
      );
    }
    last = m.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
