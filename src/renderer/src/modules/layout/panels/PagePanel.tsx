import { useState } from 'react';
import { Link, Unlink } from 'lucide-react';
import { localizeDefaultName, useT } from '../../../core/i18n';
import { Button, IconButton, Panel, Segmented, Select, TextInput, Toggle } from '../../../components/ui';
import { DEFAULT_DOC_NAMES } from '../templates';
import { MASTER_ID, type Unit } from '../types';
import { PAGE_PRESETS, UNITS, getPreset, matchPreset, orientationOf, presetSizePx } from '../units';
import type { LayoutEditor } from '../useLayoutEditor';
import { NumField, Row, UnitField } from './fields';
import { FillFields } from './ObjectPanels';

export function presetOptions(t: (k: string) => string) {
  const group = (g: string) => PAGE_PRESETS.filter((p) => p.group === g).map((p) => ({ value: p.id, label: `${t(p.name)} — ${p.w} × ${p.h} ${p.unit}` }));
  return [
    { value: 'custom', label: t('Custom size') },
    ...group('print'),
    ...group('social'),
    ...group('screen'),
  ];
}

export function PagePanel({ ed }: { ed: LayoutEditor }) {
  const t = useT();
  const doc = ed.doc;
  const page = ed.page;
  const isMaster = ed.pageId === MASTER_ID;
  const unit = doc.unit;
  const [allPages, setAllPages] = useState(true);
  const [scale, setScale] = useState(false);
  const [linkMargins, setLinkMargins] = useState(true);
  const orientation = orientationOf(page.width, page.height);

  const applySize = (w: number, h: number, preset: string) => ed.resizePages(w, h, preset, allPages || isMaster, scale);

  const setMargin = (side: 'top' | 'right' | 'bottom' | 'left', v: number) => {
    const margins = linkMargins ? { top: v, right: v, bottom: v, left: v } : { ...page.margins, [side]: v };
    ed.setPage({ margins }, allPages || isMaster, 'Margins');
  };

  return (
    <>
      <Panel title={isMaster ? t('Master page') : t('Page {n} of {count}', { n: ed.pageIndex + 1, count: doc.pages.length })}>
        {isMaster && <div className="faint ly-hint">{t('Items on the master page appear on every page that uses it. Use {page} and {pages} in text for page numbers.')}</div>}
        <Select<string>
          small
          value={getPreset(page.preset) ? page.preset : 'custom'}
          onChange={(id) => {
            const p = getPreset(id);
            if (!p) return;
            let { width, height } = presetSizePx(p);
            if (orientation === 'landscape' && height > width) [width, height] = [height, width];
            if (orientation === 'portrait' && width > height && p.group === 'print') [width, height] = [height, width];
            applySize(width, height, p.id);
          }}
          options={presetOptions(t)}
          aria-label={t('Page size')}
        />
        <div className="ly-grid2">
          <UnitField label="W" value={page.width} unit={unit} min={10} max={50000} onChange={(w) => applySize(w, page.height, matchPreset(w, page.height)?.id ?? 'custom')} />
          <UnitField label="H" value={page.height} unit={unit} min={10} max={50000} onChange={(h) => applySize(page.width, h, matchPreset(page.width, h)?.id ?? 'custom')} />
        </div>
        <Row>
          <Segmented<'portrait' | 'landscape'>
            value={orientation}
            onChange={(o) => o !== orientation && applySize(page.height, page.width, page.preset)}
            options={[
              { value: 'portrait', label: t('Portrait') },
              { value: 'landscape', label: t('Landscape') },
            ]}
          />
        </Row>
        {!isMaster && <Toggle checked={allPages} onChange={setAllPages} label={t('Apply to all pages')} />}
        <Toggle checked={scale} onChange={setScale} label={t('Scale content when resizing')} />
      </Panel>
      <Panel title={t('Margins & columns')}>
        <div className="ly-grid2">
          <UnitField label={t('Top')} value={page.margins.top} unit={unit} min={0} onChange={(v) => setMargin('top', v)} />
          <UnitField label={t('Bottom')} value={page.margins.bottom} unit={unit} min={0} onChange={(v) => setMargin('bottom', v)} />
          <UnitField label={doc.facing ? t('Inside') : t('Left')} value={page.margins.left} unit={unit} min={0} onChange={(v) => setMargin('left', v)} />
          <UnitField label={doc.facing ? t('Outside') : t('Right')} value={page.margins.right} unit={unit} min={0} onChange={(v) => setMargin('right', v)} />
        </div>
        <Row>
          <IconButton icon={linkMargins ? Link : Unlink} size="sm" label={t('Same margins on all sides')} active={linkMargins} onClick={() => setLinkMargins((l) => !l)} />
          <span className="faint ly-hint">{linkMargins ? t('All sides linked') : t('Sides independent')}</span>
        </Row>
        <div className="ly-grid2">
          <NumField label={t('Columns')} value={page.columns} min={1} max={24} precision={0} onChange={(v) => ed.setPage({ columns: Math.round(v) }, allPages || isMaster, 'Columns')} />
          <UnitField label={t('Gutter')} value={page.gutter} unit={unit} min={0} onChange={(gutter) => ed.setPage({ gutter }, allPages || isMaster, 'Gutter')} />
        </div>
        {!isMaster && (page.guides.x.length > 0 || page.guides.y.length > 0) && (
          <Button size="sm" variant="ghost" onClick={() => ed.setPage({ guides: { x: [], y: [] } }, false, 'Clear guides')}>
            {t('Clear ruler guides')}
          </Button>
        )}
      </Panel>
      {!isMaster && (
        <Panel title={t('Background')}>
          <FillFields
            fill={page.background}
            gradient={page.gradient}
            swatches={doc.swatches}
            onPatch={(p, record = true) => {
              const patch: Record<string, unknown> = {};
              if (p.fill !== undefined) patch.background = p.fill;
              if (p.gradient !== undefined) patch.gradient = p.gradient;
              ed.setPage(patch, false, 'Background', record);
            }}
          />
          <Row>
            <Button size="sm" variant="ghost" onClick={() => ed.setPage({ background: page.background, gradient: page.gradient }, true, 'Background')}>
              {t('Use on all pages')}
            </Button>
          </Row>
          <Toggle checked={page.applyMaster} onChange={(applyMaster) => ed.setPage({ applyMaster }, false, 'Master')} label={t('Show master page items')} />
        </Panel>
      )}
      <Panel title={t('Document')}>
        <TextInput small value={localizeDefaultName(t, doc.name, DEFAULT_DOC_NAMES)} aria-label={t('Name')} onChange={(e) => ed.setDoc({ name: e.target.value.slice(0, 120) }, 'Rename', false)} onBlur={() => ed.commit('Rename')} />
        <Row>
          <span className="ly-label grow">{t('Units')}</span>
          <Select<Unit> small value={unit} onChange={(u) => ed.setDoc({ unit: u }, 'Units')} options={UNITS.map((u) => ({ value: u, label: u }))} aria-label={t('Units')} style={{ width: 90 }} />
        </Row>
        <UnitField label={t('Bleed')} value={doc.bleed} unit={unit} min={0} max={200} onChange={(bleed) => ed.setDoc({ bleed }, 'Bleed')} title={t('Extra area around the page that is trimmed off after printing')} />
        <Toggle checked={doc.facing} onChange={(facing) => ed.setDoc({ facing }, 'Facing pages')} label={t('Facing pages (spreads)')} />
        {doc.facing && <Toggle checked={doc.mirrorMaster} onChange={(mirrorMaster) => ed.setDoc({ mirrorMaster }, 'Mirror master')} label={t('Mirror master items on left pages')} />}
      </Panel>
    </>
  );
}

