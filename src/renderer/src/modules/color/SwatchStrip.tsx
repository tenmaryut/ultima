import { useState } from 'react';
import { ArrowDownUp, CircleDot, Lock, LockOpen, Plus, Repeat, X } from 'lucide-react';
import { ColorPicker, DropdownButton, IconButton, Select, Slider } from '../../components/ui';
import { useT } from '../../core/i18n';
import { COLOR_FORMATS, formatColor, hsvToRgb, textOn, toHex, type ColorFormat } from './colormath';
import {
  MAX_SWATCHES,
  addSwatch,
  baseIndex,
  hexToHsv,
  moveSwatch,
  regenerate,
  removeSwatch,
  renameSwatch,
  reverseSwatches,
  setBaseIndex,
  setSwatchHex,
  sortSwatches,
  toggleLock,
  type ColorDoc,
} from './state';
import { CopyButton, ValueInput } from './widgets';

interface Props {
  doc: ColorDoc;
  selected: number;
  onSelect: (index: number) => void;
  format: ColorFormat;
  onFormat: (format: ColorFormat) => void;
  /** Recorded change. */
  onChange: (doc: ColorDoc, label: string) => void;
  /** Live change (no undo step) + commit. */
  onPreview: (doc: ColorDoc) => void;
  onCommit: (label: string) => void;
  showBrightness: boolean;
}

const DRAG_TYPE = 'application/x-ultima-swatch';

/** The palette below the wheel / image: big swatches with values, lock, base, edit and reorder. */
export function SwatchStrip({ doc, selected, onSelect, format, onFormat, onChange, onPreview, onCommit, showBrightness }: Props) {
  const t = useT();
  const bi = baseIndex(doc);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const setBrightness = (index: number, v: number) => {
    const s = doc.swatches[index];
    const hsv = hexToHsv(s.hex);
    const hex = toHex(hsvToRgb({ ...hsv, v }));
    if (index === bi && doc.rule !== 'custom') onPreview(regenerate(doc, { ...hsv, v }));
    else onPreview({ ...doc, swatches: doc.swatches.map((x, i) => (i === index ? { ...x, hex } : x)) });
  };

  return (
    <div className="co-strip-area">
      <div className="co-strip-bar">
        <Select<ColorFormat> small value={format} onChange={onFormat} options={COLOR_FORMATS.map((f) => ({ value: f.id, label: f.label }))} style={{ width: 86 }} aria-label={t('Color values')} />
        <span className="faint co-strip-count">{t('{count} colors', { count: doc.swatches.length })}</span>
        <span className="spacer" />
        <DropdownButton
          className="btn sm ghost"
          title={t('Sort colors')}
          entries={[
            { label: t('Sort by lightness'), onClick: () => onChange(sortSwatches(doc, 'lightness'), 'Sort colors') },
            { label: t('Sort by hue'), onClick: () => onChange(sortSwatches(doc, 'hue'), 'Sort colors') },
            { label: t('Sort by saturation'), onClick: () => onChange(sortSwatches(doc, 'saturation', 'desc'), 'Sort colors') },
            { type: 'separator' },
            { label: t('Reverse order'), icon: Repeat, onClick: () => onChange(reverseSwatches(doc), 'Reverse colors') },
          ]}
        >
          <ArrowDownUp size={13} /> {t('Sort')}
        </DropdownButton>
        <button
          type="button"
          className="btn sm ghost"
          disabled={doc.swatches.length >= MAX_SWATCHES}
          onClick={() => {
            onChange(addSwatch(doc, undefined, selected + 1), 'Add color');
            onSelect(Math.min(doc.swatches.length, selected + 1));
          }}
        >
          <Plus size={13} /> {t('Add color')}
        </button>
      </div>
      <div className="co-strip" role="listbox" aria-label={t('Palette')}>
        {doc.swatches.map((s, i) => {
          const isBase = i === bi;
          const fg = textOn(s.hex);
          const hsv = hexToHsv(s.hex);
          return (
            <div
              key={s.id}
              className={`co-swatch ${selected === i ? 'selected' : ''} ${dragOver === i ? 'drag-over' : ''}`}
              role="option"
              aria-selected={selected === i}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                setDragOver(i);
              }}
              onDragLeave={() => setDragOver((d) => (d === i ? null : d))}
              onDrop={(e) => {
                const from = Number(e.dataTransfer.getData(DRAG_TYPE));
                setDragOver(null);
                if (!Number.isInteger(from) || from === i) return;
                e.preventDefault();
                onChange(moveSwatch(doc, from, i), 'Reorder colors');
                onSelect(i);
              }}
            >
              <div
                className="co-swatch-color"
                style={{ background: s.hex, color: fg }}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(DRAG_TYPE, String(i));
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragEnd={() => setDragOver(null)}
                onClick={() => onSelect(i)}
                title={t('Click to select, drag to reorder')}
              >
                <div className="co-swatch-top">
                  {isBase && (
                    <span className="co-base-badge" title={t('Base color')}>
                      <CircleDot size={12} /> {t('Base')}
                    </span>
                  )}
                  <span className="spacer" />
                  {s.locked && <Lock size={13} aria-label={t('Locked')} />}
                </div>
                <span className="co-swatch-name-overlay">{s.name}</span>
                <span className="co-swatch-hex mono">{formatColor(s.hex, 'hex')}</span>
              </div>
              <div className="co-swatch-tools">
                <IconButton
                  icon={s.locked ? Lock : LockOpen}
                  size="sm"
                  active={s.locked}
                  label={s.locked ? t('Unlock color') : t('Lock color')}
                  onClick={() => onChange(toggleLock(doc, i), s.locked ? 'Unlock color' : 'Lock color')}
                />
                <IconButton icon={CircleDot} size="sm" active={isBase} label={t('Set as base color')} onClick={() => onChange(setBaseIndex(doc, i), 'Set base color')} />
                <ColorPicker
                  value={s.hex}
                  alpha={false}
                  size={20}
                  label={t('Edit color')}
                  onChange={(c) => {
                    onSelect(i);
                    onPreview(setSwatchHex(doc, i, c));
                  }}
                  onCommit={() => onCommit('Edit color')}
                />
                <CopyButton text={formatColor(s.hex, format)} label={t('Copy value')} />
                <IconButton
                  icon={X}
                  size="sm"
                  label={t('Remove color')}
                  disabled={doc.swatches.length <= 1}
                  onClick={() => {
                    onChange(removeSwatch(doc, i), 'Remove color');
                    onSelect(Math.max(0, Math.min(selected, doc.swatches.length - 2)));
                  }}
                />
              </div>
              {showBrightness && (
                <Slider
                  value={Math.round(hsv.v * 100)}
                  min={0}
                  max={100}
                  onChange={(v) => setBrightness(i, v / 100)}
                  onCommit={() => onCommit('Change brightness')}
                  format={(v) => `${v}%`}
                  label={t('Brightness')}
                  disabled={s.locked}
                />
              )}
              <ValueInput hex={s.hex} format={format} disabled={s.locked} onChange={(hex) => onChange(setSwatchHex(doc, i, hex), 'Edit color')} ariaLabel={`${t('Color')} ${i + 1} ${format.toUpperCase()}`} />
              <input
                className="input sm co-swatch-name"
                value={s.name}
                placeholder={t('Name')}
                aria-label={t('Color name')}
                onChange={(e) => onPreview(renameSwatch(doc, i, e.target.value))}
                onBlur={() => onCommit('Rename color')}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
