import { Dices, ImagePlus, RefreshCw, X } from 'lucide-react';
import { Button, Segmented, Slider } from '../../components/ui';
import { useT } from '../../core/i18n';
import { HARMONY_RULES, ruleInfo, type HarmonyRule, type WheelMode } from './harmony';
import { MOODS, type Mood } from './extract';
import { MAX_SWATCHES, spreadOf, type ColorDoc } from './state';

/** Left column of the Wheel view: harmony rules, wheel type and spread. */
export function HarmonyPanel({
  doc,
  onRule,
  onWheel,
  onSpreadPreview,
  onSpreadCommit,
  onRandom,
}: {
  doc: ColorDoc;
  onRule: (rule: HarmonyRule) => void;
  onWheel: (wheel: WheelMode) => void;
  onSpreadPreview: (value: number) => void;
  onSpreadCommit: () => void;
  onRandom: () => void;
}) {
  const t = useT();
  const info = ruleInfo(doc.rule).spread;
  return (
    <div className="co-left">
      <div className="co-left-title">{t('Color harmony')}</div>
      <div className="co-rules" role="radiogroup" aria-label={t('Color harmony')}>
        {HARMONY_RULES.map((r) => (
          <button key={r.id} type="button" role="radio" aria-checked={doc.rule === r.id} className={`co-rule ${doc.rule === r.id ? 'active' : ''}`} onClick={() => onRule(r.id)}>
            <RuleGlyph rule={r.id} />
            <span>{t(r.label)}</span>
          </button>
        ))}
      </div>
      {info && (
        <Slider
          label={info.kind === 'angle' ? t('Spread') : t('Step')}
          value={spreadOf(doc)}
          min={info.min}
          max={info.max}
          step={info.step}
          onChange={onSpreadPreview}
          onCommit={onSpreadCommit}
          defaultValue={info.default}
          format={(v) => (info.kind === 'angle' ? `${Math.round(v)}°` : `${Math.round(v * 100)}%`)}
        />
      )}
      <div className="co-left-title">{t('Wheel')}</div>
      <Segmented<WheelMode>
        value={doc.wheel}
        onChange={onWheel}
        options={[
          { value: 'ryb', label: t('Artistic (RYB)'), title: t('Painter’s wheel: red, yellow and blue are primaries') },
          { value: 'rgb', label: t('RGB'), title: t('Light based wheel used by screens') },
        ]}
      />
      <Button size="sm" icon={Dices} onClick={onRandom} title={t('New random base color')}>
        {t('Random base')}
      </Button>
    </div>
  );
}

/** Small icon showing where the rule puts colors on the wheel. */
function RuleGlyph({ rule }: { rule: HarmonyRule }) {
  const angles: Record<HarmonyRule, number[]> = {
    analogous: [-50, -25, 0, 25, 50],
    monochromatic: [0],
    triad: [0, 120, 240],
    complementary: [0, 180],
    'split-complementary': [0, 150, 210],
    square: [0, 90, 180, 270],
    compound: [0, 30, 150, 180],
    shades: [0],
    custom: [-100, 20, 140],
  };
  const radii: Partial<Record<HarmonyRule, number[]>> = { monochromatic: [3, 5.5, 8], shades: [8] };
  const pts = angles[rule].flatMap((a) => (radii[rule] ?? [8]).map((r) => ({ x: 10 + Math.sin((a * Math.PI) / 180) * r, y: 10 - Math.cos((a * Math.PI) / 180) * r })));
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden className="co-rule-glyph">
      <circle cx="10" cy="10" r="9" fill="none" stroke="currentColor" strokeOpacity="0.35" />
      {pts.map((p, i) => (
        <line key={`l${i}`} x1="10" y1="10" x2={p.x} y2={p.y} stroke="currentColor" strokeOpacity="0.5" />
      ))}
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={i === 0 ? 2.2 : 1.6} fill="currentColor" />
      ))}
    </svg>
  );
}

/** Left column of the Extract view: color mood, number of colors and image actions. */
export function ExtractPanel({
  doc,
  hasImage,
  busy,
  onMood,
  onCount,
  onShuffle,
  onOpen,
  onClear,
}: {
  doc: ColorDoc;
  hasImage: boolean;
  busy: boolean;
  onMood: (mood: Mood) => void;
  onCount: (count: number) => void;
  onShuffle: () => void;
  onOpen: () => void;
  onClear: () => void;
}) {
  const t = useT();
  return (
    <div className="co-left">
      <div className="co-left-title">{t('Color mood')}</div>
      <div className="co-rules" role="radiogroup" aria-label={t('Color mood')}>
        {MOODS.map((m) => (
          <button key={m.id} type="button" role="radio" aria-checked={doc.mood === m.id} className={`co-rule ${doc.mood === m.id ? 'active' : ''}`} onClick={() => onMood(m.id)} disabled={!hasImage || busy}>
            <span className={`co-mood-dot co-mood-${m.id}`} />
            <span>{t(m.label)}</span>
          </button>
        ))}
      </div>
      <Slider label={t('Colors')} value={doc.extractCount} min={2} max={Math.min(10, MAX_SWATCHES)} onChange={onCount} disabled={!hasImage || busy} />
      <Button size="sm" icon={RefreshCw} onClick={onShuffle} disabled={!hasImage || busy} title={t('Try a different selection of colors')}>
        {t('Shuffle')}
      </Button>
      <div className="co-left-title">{t('Image')}</div>
      <Button size="sm" icon={ImagePlus} onClick={onOpen}>
        {t('Open image…')}
      </Button>
      {hasImage && (
        <Button size="sm" variant="ghost" icon={X} onClick={onClear}>
          {t('Remove image')}
        </Button>
      )}
      <p className="faint co-left-hint">{t('Drag the circles on the image to pick colors. Click the image to move the selected color’s picker.')}</p>
    </div>
  );
}
