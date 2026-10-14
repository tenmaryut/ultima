import { useEffect, useState } from 'react';
import { Bold, CaseUpper, Italic, Link2, Plus, TextAlignCenter, TextAlignEnd, TextAlignJustify, TextAlignStart, Underline, Unlink2 } from 'lucide-react';
import { useT } from '../../../core/i18n';
import { Button, IconButton, Panel, Segmented, Select, TextArea, promptDialog } from '../../../components/ui';
import { threadOf, storyText } from '../ops';
import { resolveTextStyle } from '../styles';
import { MASTER_ID, type TextAlign, type TextFrame, type TextStyle, type VAlign } from '../types';
import { fontSizeFromDisplay, fontSizeToDisplay, fontUnit } from '../units';
import type { LayoutEditor } from '../useLayoutEditor';
import { ColorField, FontPicker, NumField, Row, UnitField } from './fields';

export const WEIGHTS: { value: number; label: string }[] = [
  { value: 100, label: 'Thin' },
  { value: 200, label: 'Extra light' },
  { value: 300, label: 'Light' },
  { value: 400, label: 'Regular' },
  { value: 500, label: 'Medium' },
  { value: 600, label: 'Semibold' },
  { value: 700, label: 'Bold' },
  { value: 800, label: 'Extra bold' },
  { value: 900, label: 'Black' },
];

/** Typography controls shared by text frames and the paragraph style editor. */
export function TypographyFields({
  style,
  unit,
  swatches,
  onChange,
}: {
  style: TextStyle;
  unit: LayoutEditor['doc']['unit'];
  swatches: string[];
  /** record=false for live previews (color dragging). */
  onChange: (patch: Partial<TextStyle>, record?: boolean) => void;
}) {
  const t = useT();
  const fu = fontUnit(unit);
  return (
    <>
      <FontPicker value={style.fontFamily} onChange={(fontFamily) => onChange({ fontFamily })} />
      <Row className="ly-type-row">
        <Select<number>
          small
          value={style.fontWeight}
          onChange={(fontWeight) => onChange({ fontWeight })}
          options={WEIGHTS.map((w) => ({ value: w.value, label: t(w.label) }))}
          aria-label={t('Weight')}
        />
        <NumField value={fontSizeToDisplay(style.fontSize, unit)} min={1} max={1500} step={1} suffix={fu} title={t('Font size')} onChange={(v) => onChange({ fontSize: fontSizeFromDisplay(v, unit) })} />
      </Row>
      <Row>
        <IconButton icon={Bold} size="sm" label={t('Bold')} active={style.fontWeight >= 700} onClick={() => onChange({ fontWeight: style.fontWeight >= 700 ? 400 : 700 })} />
        <IconButton icon={Italic} size="sm" label={t('Italic')} active={style.italic} onClick={() => onChange({ italic: !style.italic })} />
        <IconButton icon={Underline} size="sm" label={t('Underline')} active={style.underline} onClick={() => onChange({ underline: !style.underline })} />
        <IconButton icon={CaseUpper} size="sm" label={t('All caps')} active={style.uppercase} onClick={() => onChange({ uppercase: !style.uppercase })} />
        <span className="spacer" />
        <Segmented<TextAlign>
          value={style.align}
          onChange={(align) => onChange({ align })}
          options={[
            { value: 'left', icon: TextAlignStart, title: t('Align left') },
            { value: 'center', icon: TextAlignCenter, title: t('Center') },
            { value: 'right', icon: TextAlignEnd, title: t('Align right') },
            { value: 'justify', icon: TextAlignJustify, title: t('Justify') },
          ]}
        />
      </Row>
      <ColorField label={t('Color')} value={style.color} swatches={swatches} onChange={(color) => onChange({ color }, false)} onCommit={(color) => onChange({ color })} />
      <div className="ly-grid3">
        <NumField label={t('Line')} value={style.lineHeight} min={0.5} max={5} step={0.05} suffix="×" title={t('Line height')} onChange={(lineHeight) => onChange({ lineHeight })} />
        <NumField label={t('Track')} value={style.letterSpacing} min={-500} max={2000} step={10} title={t('Letter spacing (1/1000 em)')} onChange={(letterSpacing) => onChange({ letterSpacing })} />
        <UnitField label={t('After')} value={style.spaceAfter} unit={unit} min={0} title={t('Space after paragraph')} onChange={(spaceAfter) => onChange({ spaceAfter })} />
      </div>
    </>
  );
}

export function TextPanel({ ed, frame }: { ed: LayoutEditor; frame: TextFrame }) {
  const t = useT();
  const doc = ed.doc;
  const style = resolveTextStyle(frame, doc.styles);
  const isMaster = ed.pageId === MASTER_ID;
  const thread = isMaster ? [frame.id] : threadOf(doc, frame.id);
  const flow = (isMaster ? ed.masterFlows : ed.flows).get(frame.id);
  const story = isMaster ? frame.text : storyText(doc, frame.id);
  const [draft, setDraft] = useState(story);
  useEffect(() => setDraft(story), [story]);

  return (
    <>
      <Panel title={t('Text')}>
        <TextArea
          rows={4}
          value={draft}
          aria-label={t('Text')}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (draft !== story) ed.setText(frame.id, draft);
          }}
        />
        <div className="faint ly-hint">{t('Tip: double-click the frame to type on the page. Use {page} and {pages} for page numbers.')}</div>
        {flow?.overflow && <div className="ly-warn">{t('The text does not fit. Enlarge the frame, reduce the text or continue it in another frame.')}</div>}
        {!isMaster && (
          <Row>
            <Button size="sm" icon={Link2} onClick={() => ed.startLink(thread[thread.length - 1])} title={t('Click another text frame to continue the text there')}>
              {t('Link')}
            </Button>
            <Button size="sm" icon={Plus} onClick={() => ed.addLinkedFrame(thread[thread.length - 1])}>
              {t('Add frame')}
            </Button>
            {frame.nextId && <IconButton icon={Unlink2} size="sm" label={t('Unlink the next frame')} onClick={() => ed.unlink(frame.id)} />}
          </Row>
        )}
        {thread.length > 1 && <div className="faint ly-hint">{t('Frame {i} of {n} in this story', { i: thread.indexOf(frame.id) + 1, n: thread.length })}</div>}
      </Panel>
      <Panel title={t('Character & paragraph')}>
        <Row>
          <Select<string>
            small
            value={frame.styleId ?? ''}
            onChange={(id) => ed.applyStyle(id || null)}
            options={[{ value: '', label: t('(no style)') }, ...doc.styles.map((s) => ({ value: s.id, label: s.name }))]}
            aria-label={t('Paragraph style')}
          />
          <IconButton
            icon={Plus}
            size="sm"
            label={t('New style from this text')}
            onClick={async () => {
              const name = await promptDialog({ title: t('New paragraph style'), defaultValue: t('My style'), confirmLabel: t('Create') });
              if (name?.trim()) ed.addStyleFromSelection(name.trim().slice(0, 60));
            }}
          />
        </Row>
        {ed.hasOverrides && frame.styleId && (
          <Row>
            <span className="faint ly-hint grow">{t('Modified')}</span>
            <Button size="sm" variant="ghost" onClick={() => ed.clearOverrides()}>
              {t('Reset')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => ed.redefineStyle(frame.styleId!)} title={t('Update the style to match this text (changes every frame using it)')}>
              {t('Update style')}
            </Button>
          </Row>
        )}
        <TypographyFields style={style} unit={doc.unit} swatches={doc.swatches} onChange={(patch, record = true) => ed.setTextStyle(patch, record)} />
      </Panel>
      <Panel title={t('Text frame')}>
        <Row>
          <Segmented<VAlign>
            value={frame.vAlign}
            onChange={(vAlign) => ed.patchSelection({ vAlign }, 'Vertical align')}
            options={[
              { value: 'top', label: t('Top') },
              { value: 'middle', label: t('Middle') },
              { value: 'bottom', label: t('Bottom') },
            ]}
          />
        </Row>
        <div className="ly-grid2">
          <NumField label={t('Columns')} value={frame.columns} min={1} max={12} step={1} precision={0} onChange={(columns) => ed.patchSelection({ columns: Math.round(columns) }, 'Columns')} />
          <UnitField label={t('Gap')} value={frame.columnGap} unit={doc.unit} min={0} onChange={(columnGap) => ed.patchSelection({ columnGap }, 'Column gap')} />
          <UnitField label={t('Inset')} value={frame.padding} unit={doc.unit} min={0} onChange={(padding) => ed.patchSelection({ padding }, 'Inset')} />
          <UnitField label={t('Radius')} value={frame.radius} unit={doc.unit} min={0} onChange={(radius) => ed.patchSelection({ radius }, 'Corner radius')} />
        </div>
        <ColorField label={t('Fill')} allowNone value={frame.fill} swatches={doc.swatches} onChange={(fill) => ed.patchSelection({ fill }, 'Fill', false)} onCommit={(fill) => ed.patchSelection({ fill }, 'Fill')} />
        <ColorField
          label={t('Border')}
          allowNone
          value={frame.stroke}
          swatches={doc.swatches}
          onChange={(stroke) => ed.patchSelection({ stroke }, 'Border', false)}
          onCommit={(stroke) => ed.patchSelection({ stroke, strokeWidth: stroke && !frame.strokeWidth ? 1 : frame.strokeWidth }, 'Border')}
        />
        {frame.stroke && <UnitField label={t('Width')} value={frame.strokeWidth} unit={doc.unit} min={0} onChange={(strokeWidth) => ed.patchSelection({ strokeWidth }, 'Border width')} />}
      </Panel>
    </>
  );
}
