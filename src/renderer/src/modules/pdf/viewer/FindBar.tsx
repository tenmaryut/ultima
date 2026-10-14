/**
 * Find bar (Ctrl/Cmd+F): searches the text of every page, highlights matches and
 * jumps between them.
 */
import { useEffect, useRef } from 'react';
import { CaseSensitive, ChevronDown, ChevronUp, WholeWord, X } from 'lucide-react';
import { useT } from '../../../core/i18n';
import { IconButton, Spinner } from '../../../components/ui';
import { useDoc } from '../context';
import { searchDocument } from '../find';
import { usePdfUi } from '../store';
import { rectOffsetInPage } from './Viewer';
import type { PageEntry } from '../types';

export function showMatch(index: number, pages: PageEntry[]): void {
  const ui = usePdfUi.getState();
  const match = ui.find.matches[index];
  if (!match) return;
  ui.setFind({ active: index });
  const pageIndex = pages.findIndex((p) => p.id === match.page);
  if (pageIndex < 0) return;
  const top = match.rects.length ? Math.min(...match.rects.map((r) => rectOffsetInPage(pages[pageIndex], ui.viewRotation, ui.zoom, r))) : 0;
  ui.goToPage(pageIndex, top);
}

export function stepMatch(dir: 1 | -1, pages: PageEntry[]): void {
  const { find } = usePdfUi.getState();
  if (!find.matches.length) return;
  const next = (find.active + dir + find.matches.length) % find.matches.length;
  showMatch(next < 0 ? 0 : next, pages);
}

export function FindBar() {
  const t = useT();
  const history = useDoc();
  const pages = history.present.pages;
  const find = usePdfUi((s) => s.find);
  const setFind = usePdfUi((s) => s.setFind);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [find.open]);

  useEffect(() => {
    const signal = { cancelled: false };
    const query = find.query;
    if (!query.trim()) {
      setFind({ matches: [], active: -1, searching: false, progress: 0 });
      return;
    }
    const timer = setTimeout(() => {
      setFind({ searching: true, progress: 0 });
      void searchDocument(pages, query, { caseSensitive: find.caseSensitive, wholeWord: find.wholeWord }, (done, total, matches) => {
        if (!signal.cancelled) setFind({ matches, progress: done / total });
      }, signal).then((matches) => {
        if (signal.cancelled) return;
        const ui = usePdfUi.getState();
        const current = pages[ui.currentPage]?.id;
        const startAt = Math.max(0, pages.findIndex((p) => p.id === current));
        const order = new Map(pages.map((p, i) => [p.id, i]));
        const first = matches.findIndex((m) => (order.get(m.page) ?? 0) >= startAt);
        setFind({ matches, searching: false, progress: 1, active: -1 });
        if (matches.length) showMatch(first >= 0 ? first : 0, pages);
      });
    }, 250);
    return () => {
      signal.cancelled = true;
      clearTimeout(timer);
    };
  }, [find.query, find.caseSensitive, find.wholeWord, pages]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => setFind({ open: false, matches: [], active: -1 });

  return (
    <div className="pd-findbar" role="search" onPointerDown={(e) => e.stopPropagation()}>
      <input
        ref={inputRef}
        className="input sm"
        placeholder={t('Find in document…')}
        value={find.query}
        onChange={(e) => setFind({ query: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            stepMatch(e.shiftKey ? -1 : 1, pages);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            close();
          }
        }}
      />
      <span className="pd-find-count faint">
        {find.searching ? (
          <Spinner size={12} />
        ) : find.query.trim() ? (
          find.matches.length ? (
            `${find.active + 1}/${find.matches.length}`
          ) : (
            t('No matches')
          )
        ) : (
          ''
        )}
      </span>
      <IconButton icon={CaseSensitive} size="sm" label={t('Match case')} active={find.caseSensitive} onClick={() => setFind({ caseSensitive: !find.caseSensitive })} />
      <IconButton icon={WholeWord} size="sm" label={t('Whole words')} active={find.wholeWord} onClick={() => setFind({ wholeWord: !find.wholeWord })} />
      <IconButton icon={ChevronUp} size="sm" label={t('Previous match')} disabled={!find.matches.length} onClick={() => stepMatch(-1, pages)} />
      <IconButton icon={ChevronDown} size="sm" label={t('Next match')} disabled={!find.matches.length} onClick={() => stepMatch(1, pages)} />
      <IconButton icon={X} size="sm" label={t('Close')} onClick={close} />
    </div>
  );
}
