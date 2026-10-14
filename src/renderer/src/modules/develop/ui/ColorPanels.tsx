import { useRef, useState } from 'react';
import { useT } from '../../../core/i18n';
import { Segmented, Tabs } from '../../../components/ui';
import { BAND_CENTERS, BANDS, SECTION_GROUPS, clampParam, type DevelopSettings, type NumericKey } from '../params';
import { hsvToRgb } from '../color';
import { resetSection } from '../ops';
import type { Photo } from '../types';
import { editorFor, ParamSlider, Section, type SettingsEditor } from './common';

type HslTab = 'hue' | 'sat' | 'lum' | 'all';

const hsl = (h: number, s: number, l: number) => `hsl(${((h % 360) + 360) % 360} ${s}% ${l}%)`;

function trackFor(kind: 'hue' | 'sat' | 'lum', center: number, bw: boolean): string {
  if (kind === 'hue') return `linear-gradient(to right, ${hsl(center - 30, 85, 50)}, ${hsl(center, 85, 50)}, ${hsl(center + 30, 85, 50)})`;
  if (kind === 'sat') return `linear-gradient(to right, ${hsl(center, 0, 50)}, ${hsl(center, 90, 50)})`;
  return bw ? `linear-gradient(to right, #1c1c1c, ${hsl(center, 60, 45)}, #ececec)` : `linear-gradient(to right, ${hsl(center, 70, 14)}, ${hsl(center, 75, 50)}, ${hsl(center, 70, 86)})`;
}

export function HslPanel({ photo }: { photo: Photo }) {
  const t = useT();
  const [tab, setTab] = useState<HslTab>('hue');
  const ed = editorFor(photo);
  const s = photo.settings;
  const bw = s.treatment === 'bw';
  const kinds: ('hue' | 'sat' | 'lum')[] = bw ? ['lum'] : tab === 'all' ? ['hue', 'sat', 'lum'] : [tab];
  const kindTitle = { hue: t('Hue'), sat: t('Saturation'), lum: t('Luminance') };
  return (
    <Section title={bw ? t('B&W Mix') : t('HSL / Color')} defaultOpen={false} onReset={() => resetSection(photo.id, SECTION_GROUPS.hsl, `${t('Reset')} ${t('HSL / Color')}`)}>
      {!bw && (
        <Tabs<HslTab>
          value={tab}
          onChange={setTab}
          style={{ padding: 0 }}
          tabs={[
            { value: 'hue', label: t('Hue') },
            { value: 'sat', label: t('Saturation') },
            { value: 'lum', label: t('Luminance') },
            { value: 'all', label: t('All') },
          ]}
        />
      )}
      {bw && <span className="dv-hint">{t('Brighten or darken the gray tones of each original color.')}</span>}
      {kinds.map((kind) => (
        <div key={kind} className="col" style={{ gap: 4 }}>
          {(kinds.length > 1 || bw) && <span className="dv-subhead">{bw ? t('Black & White Mix') : kindTitle[kind]}</span>}
          {BANDS.map((band, i) => {
            const k = `${kind}${band}` as NumericKey;
            return <ParamSlider key={k} k={k} value={s[k]} editor={ed} label={t(band)} track={trackFor(kind, BAND_CENTERS[i], bw)} />;
          })}
        </div>
      ))}
    </Section>
  );
}

/* ------------------------------- Color grading ------------------------------ */

type Range = 'Shadow' | 'Mid' | 'High' | 'Global';
type GradeMode = '3way' | Range;

function ColorWheel({ hue, sat, editor, range, name }: { hue: number; sat: number; editor: SettingsEditor; range: Range; name: string }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const hueKey = `grade${range}Hue` as NumericKey;
  const satKey = `grade${range}Sat` as NumericKey;
  const update = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    const radius = Math.min(1, Math.hypot(dx, dy) / (r.width / 2));
    const angle = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
    editor.live({ [hueKey]: clampParam(hueKey, angle), [satKey]: clampParam(satKey, radius * 100) } as Partial<DevelopSettings>);
  };
  const rad = (hue * Math.PI) / 180;
  const rr = sat / 100;
  const [pr, pg, pb] = hsvToRgb(hue, Math.max(0.15, rr), 1).map((v) => Math.round(v * 255));
  return (
    <div className="dv-wheel-wrap">
      <div
        ref={ref}
        className="dv-wheel"
        role="slider"
        aria-label={`${name} ${t('color')}`}
        aria-valuetext={`${Math.round(hue)}°, ${Math.round(sat)}%`}
        title={t('Drag to tint · double-click to reset')}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          dragging.current = true;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          update(e);
        }}
        onPointerMove={(e) => dragging.current && update(e)}
        onPointerUp={() => {
          if (!dragging.current) return;
          dragging.current = false;
          editor.commit(`${name} ${t('color')}`);
        }}
        onDoubleClick={() => editor.apply({ [hueKey]: 0, [satKey]: 0 } as Partial<DevelopSettings>, `${t('Reset')} ${name}`)}
      >
        <span
          className="dv-wheel-puck"
          style={{ left: `${50 + Math.sin(rad) * rr * 50}%`, top: `${50 - Math.cos(rad) * rr * 50}%`, background: `rgb(${pr}, ${pg}, ${pb})` }}
        />
      </div>
      <span className="dv-wheel-name">{name}</span>
    </div>
  );
}

export function GradingPanel({ photo }: { photo: Photo }) {
  const t = useT();
  const [mode, setMode] = useState<GradeMode>('3way');
  const ed = editorFor(photo);
  const s = photo.settings;
  const names: Record<Range, string> = { Shadow: t('Shadows'), Mid: t('Midtones'), High: t('Highlights'), Global: t('Global') };
  const wheel = (range: Range) => (
    <ColorWheel range={range} name={names[range]} hue={s[`grade${range}Hue` as NumericKey]} sat={s[`grade${range}Sat` as NumericKey]} editor={ed} />
  );
  return (
    <Section title={t('Color Grading')} defaultOpen={false} onReset={() => resetSection(photo.id, SECTION_GROUPS.grading, `${t('Reset')} ${t('Color Grading')}`)}>
      <Segmented<GradeMode>
        value={mode}
        onChange={setMode}
        options={[
          { value: '3way', label: t('3-Way'), title: t('Shadows, midtones and highlights') },
          { value: 'Shadow', label: t('Shad.'), title: names.Shadow },
          { value: 'Mid', label: t('Mid.'), title: names.Mid },
          { value: 'High', label: t('High.'), title: names.High },
          { value: 'Global', label: t('Glob.'), title: names.Global },
        ]}
      />
      {mode === '3way' ? (
        <>
          <div className="dv-wheels">
            {wheel('Shadow')}
            {wheel('Mid')}
            {wheel('High')}
          </div>
          {(['Shadow', 'Mid', 'High'] as Range[]).map((r) => (
            <ParamSlider key={r} k={`grade${r}Lum` as NumericKey} value={s[`grade${r}Lum` as NumericKey]} editor={ed} label={`${names[r]} ${t('Luminance')}`} />
          ))}
        </>
      ) : (
        <>
          <div style={{ width: '62%', margin: '0 auto' }}>{wheel(mode)}</div>
          <ParamSlider k={`grade${mode}Hue` as NumericKey} value={s[`grade${mode}Hue` as NumericKey]} editor={ed} label={t('Hue')} track="linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)" />
          <ParamSlider k={`grade${mode}Sat` as NumericKey} value={s[`grade${mode}Sat` as NumericKey]} editor={ed} label={t('Saturation')} />
          <ParamSlider k={`grade${mode}Lum` as NumericKey} value={s[`grade${mode}Lum` as NumericKey]} editor={ed} label={t('Luminance')} />
        </>
      )}
      <ParamSlider k="gradeBlending" value={s.gradeBlending} editor={ed} />
      <ParamSlider k="gradeBalance" value={s.gradeBalance} editor={ed} />
    </Section>
  );
}
