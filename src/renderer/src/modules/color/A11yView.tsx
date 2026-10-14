import { useState } from 'react';
import { ArrowLeftRight, Check, Sparkles, Wand2, X } from 'lucide-react';
import { Badge, Button, ColorPicker, Panel, Slider, Spinner, Toggle } from '../../components/ui';
import { useT } from '../../core/i18n';
import { formatColor, hexToRgb } from './colormath';
import {
  CVD_TYPES,
  apcaContrast,
  apcaUsage,
  contrastHex,
  cvdConflicts,
  defaultTextPairs,
  fixPairs,
  formatRatio,
  simulateHex,
  suggestContrastFix,
  wcag,
} from './a11y';
import { setSwatchHex, type ColorDoc } from './state';
import { ChipRow } from './widgets';

interface Props {
  doc: ColorDoc;
  onChange: (doc: ColorDoc, label: string) => void;
  onMakeAccessibleAI: () => void;
  aiBusy: boolean;
}

/** A color reference: a palette swatch (by index) or a custom color. */
type Ref = { kind: 'swatch'; index: number } | { kind: 'custom'; hex: string };

/** Contrast checker (WCAG 2.1 + optional APCA), palette contrast grid and color-blindness simulation. */
export function A11yView({ doc, onChange, onMakeAccessibleAI, aiBusy }: Props) {
  const t = useT();
  const hexes = doc.swatches.map((s) => s.hex);
  const [fgRef, setFg] = useState<Ref>(() => ({ kind: 'swatch', index: 0 }));
  const [bgRef, setBg] = useState<Ref>(() => ({ kind: 'swatch', index: Math.max(0, hexes.length - 1) }));
  const [apca, setApca] = useState(false);
  const [severity, setSeverity] = useState(100);

  const resolve = (r: Ref) => (r.kind === 'swatch' ? (hexes[r.index] ?? hexes[0] ?? '#000000') : r.hex);
  const fg = resolve(fgRef);
  const bg = resolve(bgRef);
  const result = wcag(fg, bg);
  const lc = apcaContrast(hexToRgb(fg), hexToRgb(bg));
  const fixAA = result.aaNormal ? null : suggestContrastFix(fg, bg, 4.5);
  const fixAAA = result.aaaNormal ? null : suggestContrastFix(fg, bg, 7);

  const applyFix = (hex: string) => {
    if (fgRef.kind === 'swatch' && doc.swatches[fgRef.index]) {
      if (doc.swatches[fgRef.index].locked) {
        setFg({ kind: 'custom', hex });
        return;
      }
      onChange(setSwatchHex(doc, fgRef.index, hex), 'Fix contrast');
    } else setFg({ kind: 'custom', hex });
  };

  const pairs = defaultTextPairs(hexes);
  const failing = pairs.filter((p) => contrastHex(hexes[p.text], hexes[p.background]) < 4.5);

  const picker = (label: string, ref: Ref, set: (r: Ref) => void) => (
    <div className="co-a11y-pick">
      <span className="field-label">{label}</span>
      <div className="row">
        <ChipRow colors={hexes} selected={ref.kind === 'swatch' ? ref.index : null} onPick={(index) => set({ kind: 'swatch', index })} />
        <ColorPicker value={resolve(ref)} alpha={false} label={t('Custom color')} onChange={(hex) => set({ kind: 'custom', hex })} />
        <span className="mono faint">{formatColor(resolve(ref), 'hex')}</span>
      </div>
    </div>
  );

  const badge = (ok: boolean, label: string, need: string) => (
    <div className={`co-wcag ${ok ? 'pass' : 'fail'}`}>
      {ok ? <Check size={14} /> : <X size={14} />}
      <span className="grow">{label}</span>
      <span className="faint">{need}</span>
    </div>
  );

  return (
    <div className="co-a11y">
      <Panel title={t('Contrast checker')}>
        <div className="co-a11y-pickers">
          {picker(t('Text'), fgRef, setFg)}
          <Button
            size="sm"
            variant="ghost"
            icon={ArrowLeftRight}
            title={t('Swap text and background')}
            onClick={() => {
              setFg(bgRef);
              setBg(fgRef);
            }}
          />
          {picker(t('Background'), bgRef, setBg)}
        </div>
        <div className="co-a11y-result">
          <div className="co-a11y-sample" style={{ background: bg, color: fg }}>
            <div style={{ fontSize: 26, fontWeight: 700 }}>{t('Large text sample')}</div>
            <div style={{ fontSize: 15 }}>{t('Normal text: the quick brown fox jumps over the lazy dog.')}</div>
            <div className="row" style={{ marginTop: 6 }}>
              <span className="co-a11y-ui" style={{ borderColor: fg, color: fg }}>
                {t('Button')}
              </span>
              <span className="co-a11y-icon" style={{ background: fg }} />
            </div>
          </div>
          <div className="co-a11y-scores">
            <div className="co-ratio">
              <span>{formatRatio(result.ratio)}</span>
              <span className="faint">{t('Contrast ratio')}</span>
            </div>
            {badge(result.aaNormal, t('AA normal text'), '4.5:1')}
            {badge(result.aaLarge, t('AA large text'), '3:1')}
            {badge(result.aaaNormal, t('AAA normal text'), '7:1')}
            {badge(result.aaaLarge, t('AAA large text'), '4.5:1')}
            {badge(result.ui, t('UI components & graphics'), '3:1')}
            <Toggle checked={apca} onChange={setApca} label={t('Show APCA (WCAG 3 draft)')} />
            {apca && (
              <div className="co-apca">
                <strong>Lc {lc.toFixed(1)}</strong>
                <span className="muted">{t(apcaUsage(lc))}</span>
              </div>
            )}
          </div>
        </div>
        {(fixAA || fixAAA) && (
          <div className="co-a11y-fixes">
            <span className="muted">{t('Closest text colors that pass:')}</span>
            {fixAA && (
              <button type="button" className="co-fix" onClick={() => applyFix(fixAA)}>
                <span style={{ background: fixAA }} /> AA · {fixAA.toUpperCase()}
              </button>
            )}
            {fixAAA && fixAAA !== fixAA && (
              <button type="button" className="co-fix" onClick={() => applyFix(fixAAA)}>
                <span style={{ background: fixAAA }} /> AAA · {fixAAA.toUpperCase()}
              </button>
            )}
          </div>
        )}
      </Panel>

      <Panel title={t('Palette contrast')}>
        <div className="co-matrix-wrap">
          <table className="co-matrix">
            <thead>
              <tr>
                <th className="faint">{t('Text ↓ / Background →')}</th>
                {hexes.map((h, j) => (
                  <th key={j}>
                    <span className="co-matrix-chip" style={{ background: h }} title={h.toUpperCase()} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {hexes.map((a, i) => (
                <tr key={i}>
                  <th>
                    <span className="co-matrix-chip" style={{ background: a }} title={a.toUpperCase()} />
                  </th>
                  {hexes.map((b, j) => {
                    if (i === j) return <td key={j} className="faint">—</td>;
                    const r = contrastHex(a, b);
                    const level = r >= 7 ? 'AAA' : r >= 4.5 ? 'AA' : r >= 3 ? t('Large') : '';
                    return (
                      <td
                        key={j}
                        className={`co-matrix-cell ${r >= 4.5 ? 'pass' : r >= 3 ? 'large' : 'fail'}`}
                        style={{ background: b, color: a }}
                        onClick={() => {
                          setFg({ kind: 'swatch', index: i });
                          setBg({ kind: 'swatch', index: j });
                        }}
                        title={t('Check this pair')}
                      >
                        <span className="co-matrix-aa">Aa</span>
                        <span className="co-matrix-ratio">
                          {r.toFixed(1)}
                          {level && <em>{level}</em>}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          {failing.length ? (
            <Badge tone="warn">{t('{count} text pair(s) below AA', { count: failing.length })}</Badge>
          ) : (
            <Badge tone="ok">{t('All suggested text pairs pass AA')}</Badge>
          )}
          <Button
            size="sm"
            icon={Wand2}
            disabled={!failing.length}
            onClick={() => {
              const fixed = fixPairs(hexes, pairs, 4.5, doc.swatches.map((s) => s.locked));
              onChange({ ...doc, rule: 'custom', swatches: doc.swatches.map((s, i) => (fixed[i] !== s.hex ? { ...s, hex: fixed[i] } : s)) }, 'Fix contrast');
            }}
            title={t('Adjusts the lightness of failing text colors until they reach 4.5:1')}
          >
            {t('Auto-fix text pairs')}
          </Button>
          <Button size="sm" icon={Sparkles} disabled={aiBusy || hexes.length < 2} onClick={onMakeAccessibleAI}>
            {aiBusy ? <Spinner size={12} /> : null}
            {t('Make it accessible (AI)')}
          </Button>
        </div>
      </Panel>

      <Panel title={t('Color blindness simulation')}>
        <Slider label={t('Severity')} value={severity} min={10} max={100} step={5} onChange={setSeverity} format={(v) => (v >= 100 ? t('100% · complete deficiency') : t('{value}% · partial (anomalous trichromacy)', { value: v }))} />
        <div className="co-cvd">
          <div className="co-cvd-row">
            <div className="co-cvd-label">
              <strong>{t('Normal vision')}</strong>
            </div>
            <div className="co-cvd-strip">
              {hexes.map((h, i) => (
                <span key={i} style={{ background: h }} title={h.toUpperCase()} />
              ))}
            </div>
          </div>
          {CVD_TYPES.map((type) => {
            const sev = severity / 100;
            const sim = hexes.map((h) => simulateHex(h, type.id, sev));
            const conflicts = cvdConflicts(hexes, type.id, sev);
            return (
              <div className="co-cvd-row" key={type.id}>
                <div className="co-cvd-label">
                  <strong>{t(type.label)}</strong>
                  <span className="faint">{t(type.description)}</span>
                </div>
                <div className="co-cvd-strip">
                  {sim.map((h, i) => (
                    <span key={i} style={{ background: h }} title={`${hexes[i].toUpperCase()} → ${h.toUpperCase()}`} />
                  ))}
                </div>
                <div className="co-cvd-note">
                  {conflicts.length ? (
                    <Badge tone="warn">{t('Look alike: {pairs}', { pairs: conflicts.map((c) => `${c.a + 1}↔${c.b + 1}`).join(', ') })}</Badge>
                  ) : (
                    <Badge tone="ok">{t('Distinguishable')}</Badge>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}
