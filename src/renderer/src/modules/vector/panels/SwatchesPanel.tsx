import { Ban, Plus, Pipette } from 'lucide-react';
import { IconButton, Segmented, toast } from '../../../components/ui';
import { useT } from '../../../core/i18n';
import { DEFAULT_SWATCHES } from '../../../core/utils/color';
import type { EditActions } from '../actions';
import { collectColors } from '../colors';
import { useEditor } from '../editor';
import { NONE, solid } from '../model';
import { findById, topLevelSelection } from '../ops';

export function SwatchesPanel({ actions }: { actions: EditActions }) {
  const t = useT();
  const core = useEditor();
  const swatches = core.doc.swatches;

  const currentColor = (): string | null => {
    const ids = topLevelSelection(core.doc.objects, core.selection);
    const o = ids.length ? findById(core.doc.objects, ids[0]) : null;
    const paint = o && o.type !== 'group' ? (core.paintTarget === 'fill' ? o.fill : o.stroke.paint) : core.paintTarget === 'fill' ? core.style.fill : core.style.stroke.paint;
    if (paint.type === 'solid') return paint.color;
    if (paint.type === 'linear' || paint.type === 'radial') return paint.stops[0]?.color ?? null;
    return null;
  };

  const swatch = (c: string, removable: boolean) => (
    <button
      key={c}
      type="button"
      className="vc-swatch"
      style={{ background: c }}
      title={removable ? `${c} — ${t('Alt+click to remove')}` : c}
      aria-label={c}
      onClick={(e) => {
        if (removable && e.altKey) actions.removeSwatch(c);
        else actions.applyPaint(solid(c));
      }}
      onContextMenu={(e) => {
        if (!removable) return;
        e.preventDefault();
        actions.removeSwatch(c);
      }}
    />
  );

  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="row" style={{ gap: 6 }}>
        <Segmented<'fill' | 'stroke'>
          value={core.paintTarget}
          options={[
            { value: 'fill', label: t('Fill') },
            { value: 'stroke', label: t('Stroke') },
          ]}
          onChange={core.setPaintTarget}
        />
        <span className="spacer" />
        <IconButton icon={Ban} size="sm" label={t('None')} onClick={() => actions.applyPaint(NONE)} />
        <IconButton
          icon={Plus}
          size="sm"
          label={t('Add the current color')}
          onClick={() => {
            const c = currentColor();
            if (!c) return toast.info(t('Select an object with a solid color first'));
            if (!actions.addSwatches([c])) toast.info(t('That color is already a swatch'));
          }}
        />
        <IconButton
          icon={Pipette}
          size="sm"
          label={t('Add document colors')}
          onClick={() => {
            const n = actions.addSwatches(collectColors(core.doc.objects));
            toast.info(n ? t('{count} colors added', { count: n }) : t('No new colors found'));
          }}
        />
      </div>
      <div className="vc-swatch-label faint">{t('Document swatches')}</div>
      {swatches.length ? <div className="vc-swatch-grid">{swatches.map((c) => swatch(c, true))}</div> : <div className="faint" style={{ fontSize: 12 }}>{t('Palettes sent from Color Studio appear here.')}</div>}
      <div className="vc-swatch-label faint">{t('Default palette')}</div>
      <div className="vc-swatch-grid">{DEFAULT_SWATCHES.map((c) => swatch(c, false))}</div>
    </div>
  );
}
