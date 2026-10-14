/**
 * "Document" tab: metadata (title, author, subject, keywords, creator), file and page
 * information, and save options.
 */
import { useEffect, useState } from 'react';
import { useT } from '../../../core/i18n';
import { formatBytes } from '../../../core/utils/format';
import { Field, Panel, TextInput, Toggle } from '../../../components/ui';
import { useDoc } from '../context';
import { engine } from '../engine';
import { usePdfUi } from '../store';
import type { DocMeta } from '../types';
import { describePageSize } from './StatusBar';

function MetaInput({ field, label, value }: { field: keyof DocMeta; label: string; value: string }) {
  const history = useDoc();
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <Field label={label}>
      <TextInput
        small
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== value) history.set((d) => ({ ...d, meta: { ...d.meta, [field]: draft } }), { label: 'Document properties' });
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLElement).blur()}
      />
    </Field>
  );
}

export function DocumentPanel() {
  const t = useT();
  const history = useDoc();
  const doc = history.present;
  const info = usePdfUi((s) => s.docInfo);
  const notesAsComments = usePdfUi((s) => s.notesAsComments);
  const flatten = usePdfUi((s) => s.flattenForms);
  const set = usePdfUi((s) => s.set);
  const sizes = new Map<string, number>();
  for (const p of doc.pages) {
    const i = engine.info(p);
    if (!i) continue;
    const w = (i.view[2] - i.view[0]) * i.userUnit;
    const h = (i.view[3] - i.view[1]) * i.userUnit;
    const label = engine.rotation(p) % 180 === 0 ? describePageSize(w, h) : describePageSize(h, w);
    sizes.set(label, (sizes.get(label) ?? 0) + 1);
  }
  const sizeList = [...sizes.entries()].sort((a, b) => b[1] - a[1]);
  return (
    <>
      <Panel title={t('Properties')}>
        <MetaInput field="title" label={t('Title')} value={doc.meta.title} />
        <MetaInput field="author" label={t('Author')} value={doc.meta.author} />
        <MetaInput field="subject" label={t('Subject')} value={doc.meta.subject} />
        <MetaInput field="keywords" label={t('Keywords (comma separated)')} value={doc.meta.keywords} />
        <MetaInput field="creator" label={t('Creator')} value={doc.meta.creator} />
      </Panel>
      <Panel title={t('Information')}>
        <div className="pd-kv">
          <span>{t('File')}</span>
          <span>{info?.name}</span>
          {info?.fileSize ? (
            <>
              <span>{t('Original size')}</span>
              <span>{formatBytes(info.fileSize)}</span>
            </>
          ) : null}
          <span>{t('Pages')}</span>
          <span>{doc.pages.length}</span>
          <span>{t('Page size')}</span>
          <span>
            {sizeList.slice(0, 3).map(([label, n]) => (
              <span key={label} style={{ display: 'block' }}>
                {label}
                {sizeList.length > 1 ? ` × ${n}` : ''}
              </span>
            ))}
          </span>
          <span>{t('Form fields')}</span>
          <span>{info?.fieldDefs.length ?? 0}</span>
          <span>{t('Annotations')}</span>
          <span>{doc.annots.length}</span>
          <span>{t('Bookmarks')}</span>
          <span>{info?.outline.length ? t('Yes') : t('No')}</span>
          <span>{t('Password protected')}</span>
          <span>{info?.encrypted ? t('Yes (saved without password)') : t('No')}</span>
        </div>
      </Panel>
      <Panel title={t('Saving')}>
        <Toggle checked={notesAsComments} onChange={(v) => set({ notesAsComments: v })} label={t('Save sticky notes as PDF comments')} />
        <Toggle checked={flatten} onChange={(v) => set({ flattenForms: v })} label={t('Flatten form fields')} />
        <div className="faint" style={{ fontSize: 11.5 }}>
          {t('Text, drawings, shapes, images, stamps and signatures are merged into the pages when you save, so they look the same in every PDF reader. Save a project (.ultima) to keep editing them later.')}
        </div>
      </Panel>
    </>
  );
}
