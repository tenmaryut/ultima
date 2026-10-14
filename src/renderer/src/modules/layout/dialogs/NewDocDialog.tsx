import { useMemo, useState } from 'react';
import { FilePlus, LayoutTemplate } from 'lucide-react';
import { useT } from '../../../core/i18n';
import { Button, Field, Modal, NumberField, Segmented, Select, Tabs, Toggle } from '../../../components/ui';
import { createDoc } from '../model';
import { PageView } from '../PageView';
import { TEMPLATES, buildTemplate, type TemplateDef } from '../templates';
import type { LayoutDoc, Unit } from '../types';
import { PAGE_PRESETS, UNITS, defaultBleed, defaultMargin, formatLength, fromUnit, getPreset, presetSizePx, toUnit, type PresetGroup } from '../units';

type Category = 'all' | 'print' | 'social' | 'presentation';

/** Live thumbnail of a template's first page inside a fixed box. */
function TemplateThumb({ doc, box }: { doc: LayoutDoc; box: number }) {
  const p = doc.pages[0];
  const scale = Math.min(box / p.width, box / p.height);
  return (
    <div className="ly-tpl-thumb" style={{ height: box }}>
      <div style={{ width: p.width * scale, height: p.height * scale, position: 'relative', boxShadow: 'var(--shadow-sm)' }}>
        <PageView doc={doc} page={p} pageIndex={0} idPrefix={`tpl-${doc.id}`} scale={scale} />
      </div>
    </div>
  );
}

export function TemplateGallery({ onPick, compact }: { onPick: (def: TemplateDef) => void; compact?: boolean }) {
  const t = useT();
  const [cat, setCat] = useState<Category>('all');
  const previews = useMemo(() => TEMPLATES.map((def) => ({ def, doc: def.build() })), []);
  const shown = previews.filter((p) => cat === 'all' || p.def.category === cat);
  return (
    <div className="col" style={{ gap: 10 }}>
      <Segmented<Category>
        value={cat}
        onChange={setCat}
        options={[
          { value: 'all', label: t('All') },
          { value: 'print', label: t('Print') },
          { value: 'social', label: t('Social media') },
          { value: 'presentation', label: t('Presentations') },
        ]}
      />
      <div className={`ly-tpl-grid ${compact ? 'compact' : ''}`}>
        {shown.map(({ def, doc }) => (
          <button key={def.id} type="button" className="ly-tpl-card" onClick={() => onPick(def)} title={t(def.description)}>
            <TemplateThumb doc={doc} box={compact ? 130 : 150} />
            <span className="ly-tpl-name">{t(def.name)}</span>
            <span className="ly-tpl-desc faint">
              {doc.pages.length > 1 ? t('{n} pages', { n: doc.pages.length }) : t(getPreset(doc.pages[0].preset)?.name ?? 'Custom size')}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

const GROUP_LABEL: Record<PresetGroup, string> = { print: 'Print', social: 'Social media', screen: 'Screen & slides' };

export function BlankDocForm({ onCreate }: { onCreate: (doc: LayoutDoc) => void }) {
  const t = useT();
  const [presetId, setPresetId] = useState('a4');
  const preset = getPreset(presetId);
  const [unit, setUnit] = useState<Unit>(preset?.unit ?? 'mm');
  const initial = preset ? presetSizePx(preset) : { width: 793.7, height: 1122.5 };
  const [w, setW] = useState(initial.width);
  const [h, setH] = useState(initial.height);
  const [pages, setPages] = useState(1);
  const [facing, setFacing] = useState(false);
  const [columns, setColumns] = useState(1);
  const [margin, setMargin] = useState(defaultMargin(initial.width, initial.height));
  const [bleed, setBleed] = useState(defaultBleed(preset));
  const landscape = w > h;

  const pick = (id: string) => {
    const p = getPreset(id);
    setPresetId(id);
    if (!p) return;
    const s = presetSizePx(p);
    const [nw, nh] = landscape && s.height > s.width && p.group === 'print' ? [s.height, s.width] : [s.width, s.height];
    setW(nw);
    setH(nh);
    setUnit(p.unit);
    setMargin(defaultMargin(nw, nh));
    setBleed(defaultBleed(p));
  };

  const decimals = unit === 'in' ? 3 : unit === 'px' ? 0 : 1;
  return (
    <div className="ly-blank">
      <div className="ly-preset-list">
        {(['print', 'social', 'screen'] as PresetGroup[]).map((g) => (
          <div key={g} className="col" style={{ gap: 4 }}>
            <div className="ly-label">{t(GROUP_LABEL[g])}</div>
            <div className="ly-preset-grid">
              {PAGE_PRESETS.filter((p) => p.group === g).map((p) => {
                const s = presetSizePx(p);
                const r = Math.min(34 / s.width, 34 / s.height);
                return (
                  <button key={p.id} type="button" className={`ly-preset ${presetId === p.id ? 'active' : ''}`} onClick={() => pick(p.id)}>
                    <span className="ly-preset-shape" style={{ width: s.width * r, height: s.height * r }} />
                    <span className="ly-preset-name">{t(p.name)}</span>
                    <span className="faint ly-preset-size">
                      {p.w} × {p.h} {p.unit}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="ly-blank-form">
        <div className="row">
          <Field label={t('Width')}>
            <NumberField value={+toUnit(w, unit).toFixed(decimals)} min={0.1} suffix={unit} onChange={(v) => { setW(fromUnit(v, unit)); setPresetId('custom'); }} />
          </Field>
          <Field label={t('Height')}>
            <NumberField value={+toUnit(h, unit).toFixed(decimals)} min={0.1} suffix={unit} onChange={(v) => { setH(fromUnit(v, unit)); setPresetId('custom'); }} />
          </Field>
        </div>
        <div className="row">
          <Field label={t('Units')}>
            <Select<Unit> value={unit} onChange={setUnit} options={UNITS.map((u) => ({ value: u, label: u }))} />
          </Field>
          <Field label={t('Orientation')}>
            <Segmented<'portrait' | 'landscape'>
              value={landscape ? 'landscape' : 'portrait'}
              onChange={(o) => {
                if ((o === 'landscape') !== landscape) {
                  setW(h);
                  setH(w);
                }
              }}
              options={[
                { value: 'portrait', label: t('Portrait') },
                { value: 'landscape', label: t('Landscape') },
              ]}
            />
          </Field>
        </div>
        <div className="row">
          <Field label={t('Pages')}>
            <NumberField value={pages} min={1} max={500} onChange={(v) => setPages(Math.round(v))} />
          </Field>
          <Field label={t('Columns')}>
            <NumberField value={columns} min={1} max={12} onChange={(v) => setColumns(Math.round(v))} />
          </Field>
        </div>
        <div className="row">
          <Field label={t('Margins')}>
            <NumberField value={+toUnit(margin, unit).toFixed(decimals)} min={0} suffix={unit} onChange={(v) => setMargin(fromUnit(v, unit))} />
          </Field>
          <Field label={t('Bleed')}>
            <NumberField value={+toUnit(bleed, unit).toFixed(decimals)} min={0} suffix={unit} onChange={(v) => setBleed(fromUnit(v, unit))} />
          </Field>
        </div>
        <Toggle checked={facing} onChange={setFacing} label={t('Facing pages (spreads)')} />
        <div className="faint ly-hint">
          {formatLength(w, unit)} × {formatLength(h, unit)}
        </div>
        <Button
          variant="primary"
          icon={FilePlus}
          onClick={() =>
            onCreate(
              createDoc({
                presetId: presetId === 'custom' ? undefined : presetId,
                width: w,
                height: h,
                pages,
                unit,
                facing,
                columns,
                margins: { top: margin, right: margin, bottom: margin, left: margin },
                bleed,
              }),
            )
          }
        >
          {t('Create document')}
        </Button>
      </div>
    </div>
  );
}

export function NewDocDialog({ onClose, onCreate, initialTab = 'templates' }: { onClose: () => void; onCreate: (doc: LayoutDoc) => void; initialTab?: 'templates' | 'blank' }) {
  const t = useT();
  const [tab, setTab] = useState<'templates' | 'blank'>(initialTab);
  return (
    <Modal title={t('New document')} onClose={onClose} width={1040}>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'templates', label: t('Templates'), icon: LayoutTemplate },
          { value: 'blank', label: t('Blank document'), icon: FilePlus },
        ]}
      />
      <div className="ly-newdoc-body">
        {tab === 'templates' ? (
          <TemplateGallery
            onPick={(def) => {
              onCreate(buildTemplate(def));
            }}
          />
        ) : (
          <BlankDocForm onCreate={onCreate} />
        )}
      </div>
    </Modal>
  );
}
