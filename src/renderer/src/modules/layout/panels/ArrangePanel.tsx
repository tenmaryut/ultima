import { useState } from 'react';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  ArrowDown,
  ArrowUp,
  BringToFront,
  Group,
  Link,
  Lock,
  LockOpen,
  SendToBack,
  Ungroup,
  Unlink,
} from 'lucide-react';
import { useT } from '../../../core/i18n';
import { IconButton, Panel, Slider, TextInput, Toggle } from '../../../components/ui';
import { mapRect } from '../geometry';
import { selectionBounds, updateFrames } from '../ops';
import type { LayoutEditor } from '../useLayoutEditor';
import { NumField, Row, UnitField } from './fields';

export function ArrangePanel({ ed }: { ed: LayoutEditor }) {
  const t = useT();
  const [keepRatio, setKeepRatio] = useState(false);
  const [toPage, setToPage] = useState(false);
  const sel = ed.selected;
  if (!sel.length) return null;
  const single = sel.length === 1 ? sel[0] : null;
  const box = single ?? selectionBounds(sel, ed.selection)!;
  const unit = ed.doc.unit;
  const locked = sel.every((f) => f.locked);
  const grouped = sel.some((f) => f.groupId);

  const setBox = (patch: Partial<{ x: number; y: number; w: number; h: number }>) => {
    let next = { x: box.x, y: box.y, w: box.w, h: box.h, ...patch };
    if (keepRatio && box.w > 0 && box.h > 0) {
      if (patch.w !== undefined) next = { ...next, h: (patch.w * box.h) / box.w };
      else if (patch.h !== undefined) next = { ...next, w: (patch.h * box.w) / box.h };
    }
    if (single) {
      ed.patchSelection(next, 'Transform');
      return;
    }
    const from = { x: box.x, y: box.y, w: box.w, h: box.h };
    ed.set(
      updateFrames(ed.current(), ed.pageId, ed.selection, (f) => ({ ...f, ...mapRect(f, from, next) })),
      'Transform',
    );
  };

  return (
    <Panel title={sel.length > 1 ? t('{n} objects', { n: sel.length }) : t('Position & size')}>
      {single && (
        <TextInput small value={single.name} placeholder={t('Name')} aria-label={t('Name')} onChange={(e) => ed.patchSelection({ name: e.target.value }, 'Rename', false)} onBlur={() => ed.commit('Rename')} />
      )}
      <div className="ly-grid2">
        <UnitField label="X" value={box.x} unit={unit} onChange={(x) => setBox({ x })} disabled={locked} />
        <UnitField label="Y" value={box.y} unit={unit} onChange={(y) => setBox({ y })} disabled={locked} />
        <UnitField label="W" value={box.w} unit={unit} min={0.5} onChange={(w) => setBox({ w })} disabled={locked} />
        <UnitField label="H" value={box.h} unit={unit} min={0.5} onChange={(h) => setBox({ h })} disabled={locked} />
      </div>
      <Row>
        <IconButton icon={keepRatio ? Link : Unlink} size="sm" label={t('Keep proportions')} active={keepRatio} onClick={() => setKeepRatio((k) => !k)} />
        {single && (
          <NumField label="∠" value={single.rotation} min={-360} max={360} suffix="°" title={t('Rotation')} onChange={(rotation) => ed.patchSelection({ rotation: ((rotation + 540) % 360) - 180 }, 'Rotate')} />
        )}
        {!single && (
          <>
            <IconButton icon={ArrowUp} size="sm" label={t('Rotate 90° left')} onClick={() => ed.rotateSelection(-90)} />
            <IconButton icon={ArrowDown} size="sm" label={t('Rotate 90° right')} onClick={() => ed.rotateSelection(90)} />
          </>
        )}
        <span className="spacer" />
        <IconButton icon={locked ? Lock : LockOpen} size="sm" label={locked ? t('Unlock') : t('Lock')} active={locked} onClick={() => ed.toggleLock()} />
      </Row>
      <Slider
        label={t('Opacity')}
        min={0}
        max={100}
        value={Math.round((single?.opacity ?? sel[0].opacity) * 100)}
        format={(v) => `${v}%`}
        defaultValue={100}
        onChange={(v) => ed.patchSelection({ opacity: v / 100 }, 'Opacity', false)}
        onCommit={() => ed.commit('Opacity')}
      />
      <div className="ly-label">{t('Align')}</div>
      <Row>
        <IconButton icon={AlignStartVertical} size="sm" label={t('Align left edges')} onClick={() => ed.align('left', toPage)} />
        <IconButton icon={AlignCenterVertical} size="sm" label={t('Align horizontal centers')} onClick={() => ed.align('hcenter', toPage)} />
        <IconButton icon={AlignEndVertical} size="sm" label={t('Align right edges')} onClick={() => ed.align('right', toPage)} />
        <IconButton icon={AlignStartHorizontal} size="sm" label={t('Align top edges')} onClick={() => ed.align('top', toPage)} />
        <IconButton icon={AlignCenterHorizontal} size="sm" label={t('Align vertical centers')} onClick={() => ed.align('vcenter', toPage)} />
        <IconButton icon={AlignEndHorizontal} size="sm" label={t('Align bottom edges')} onClick={() => ed.align('bottom', toPage)} />
      </Row>
      <Row>
        <IconButton icon={AlignHorizontalDistributeCenter} size="sm" label={t('Distribute horizontally')} disabled={sel.length < 3} onClick={() => ed.distribute('x')} />
        <IconButton icon={AlignVerticalDistributeCenter} size="sm" label={t('Distribute vertically')} disabled={sel.length < 3} onClick={() => ed.distribute('y')} />
        <span className="spacer" />
        <Toggle checked={toPage || sel.length === 1} disabled={sel.length === 1} onChange={setToPage} label={t('To page')} />
      </Row>
      <div className="ly-label">{t('Arrange')}</div>
      <Row>
        <IconButton icon={BringToFront} size="sm" label={t('Bring to front')} onClick={() => ed.reorder('front')} />
        <IconButton icon={ArrowUp} size="sm" label={t('Bring forward')} onClick={() => ed.reorder('forward')} />
        <IconButton icon={ArrowDown} size="sm" label={t('Send backward')} onClick={() => ed.reorder('backward')} />
        <IconButton icon={SendToBack} size="sm" label={t('Send to back')} onClick={() => ed.reorder('back')} />
        <span className="spacer" />
        <IconButton icon={Group} size="sm" label={t('Group')} disabled={sel.length < 2} onClick={() => ed.group()} />
        <IconButton icon={Ungroup} size="sm" label={t('Ungroup')} disabled={!grouped} onClick={() => ed.ungroup()} />
      </Row>
    </Panel>
  );
}
