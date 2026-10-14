import { create } from 'zustand';
import { useT } from '../../../core/i18n';
import { formatZoom } from '../../../core/viewport';
import { formatBytes } from '../../../core/utils/format';
import { toHex } from '../../../core/utils/color';
import type { StatusInfo } from '../engine';
import type { PhotoDoc } from '../types';

export const useStatusStore = create<{ info: StatusInfo | null; busy: string | null }>(() => ({ info: null, busy: null }));

export function setBusy(label: string | null): void {
  useStatusStore.setState({ busy: label });
}

export function StatusBar({ doc, zoom, memory, hint }: { doc: PhotoDoc | null; zoom: number; memory: number; hint: string }) {
  const t = useT();
  const info = useStatusStore((s) => s.info);
  const busy = useStatusStore((s) => s.busy);
  if (!doc) return <span>{t('No document')}</span>;
  const inside = info && info.x >= 0 && info.y >= 0 && info.x < doc.width && info.y < doc.height;
  return (
    <>
      <span title={t('Document size')}>
        {doc.width} × {doc.height} px
      </span>
      <span title={t('Zoom')}>{formatZoom(zoom)}</span>
      <span className="ph-status-pos" title={t('Cursor position')}>
        {inside ? `X ${info.x}  Y ${info.y}` : '—'}
      </span>
      {inside && info.color && (
        <span className="row" style={{ gap: 6 }} title={t('Color under the cursor')}>
          <span className="ph-status-swatch" style={{ background: `rgba(${info.color[0]},${info.color[1]},${info.color[2]},${info.color[3] / 255})` }} />
          <span className="mono">
            R{info.color[0]} G{info.color[1]} B{info.color[2]}
            {info.color[3] < 255 ? ` A${Math.round((info.color[3] / 255) * 100)}%` : ''}
          </span>
          <span className="mono faint">{toHex({ r: info.color[0], g: info.color[1], b: info.color[2] })}</span>
        </span>
      )}
      {doc.selection && (
        <span title={t('Selection')}>
          {t('Selection')}: {doc.selection.bounds.w} × {doc.selection.bounds.h}
        </span>
      )}
      <span className="spacer" />
      {busy && <span className="ph-busy">{busy}</span>}
      <span className="faint ph-hint">{hint}</span>
      <span className="faint" title={t('Memory used by the undo history')}>
        {t('History')}: {formatBytes(memory)}
      </span>
    </>
  );
}
