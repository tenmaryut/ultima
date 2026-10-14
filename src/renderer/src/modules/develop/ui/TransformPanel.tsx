import { ArrowLeftRight, Crop, FlipHorizontal2, FlipVertical2, Ruler, RotateCcw, RotateCw } from 'lucide-react';
import { useT } from '../../../core/i18n';
import { Button, IconButton, Select, promptDialog, toast } from '../../../components/ui';
import { geometry } from '../geometry';
import { ASPECT_PRESETS, SECTION_GROUPS, sanitizeAspect, type DevelopSettings } from '../params';
import { flipPhotos, resetSection, rotatePhotos, withAspect, withStraighten } from '../ops';
import { getPhoto, setStore, useDevelop, type OverlayGrid } from '../store';
import type { Photo } from '../types';
import { editorFor, ParamSlider, Section, type SettingsEditor } from './common';

export function aspectLabel(a: string, t: (k: string) => string): string {
  if (a === 'original') return t('Original');
  if (a === 'free') return t('Free');
  return a.replace(':', ' × ');
}

/** Swaps a w:h aspect to h:w (portrait ↔ landscape). */
export function swapAspect(photo: Photo): void {
  const s = photo.settings;
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(s.cropAspect);
  const W = photo.width;
  const H = photo.height;
  if (!W || !H) return;
  let next: string;
  if (m) next = `${m[2]}:${m[1]}`;
  else {
    // free/original: flip the current crop's proportions
    const geo = geometry(s, W, H);
    next = sanitizeAspect(`${geo.outH}:${geo.outW}`);
  }
  editorFor(photo).apply(withAspect(s, next, W, H), 'Crop');
}

export function TransformPanel({ photo }: { photo: Photo }) {
  const t = useT();
  const cropMode = useDevelop((s) => s.cropMode);
  const overlay = useDevelop((s) => s.overlay);
  const tool = useDevelop((s) => s.tool);
  const s = photo.settings;
  const ed = editorFor(photo);
  const W = photo.width;
  const H = photo.height;
  const geo = W && H ? geometry(s, W, H) : null;
  const latest = () => getPhoto(photo.id)?.settings ?? s;
  // straighten also keeps the crop inside the rotated image
  const straightenEditor: SettingsEditor = {
    ...ed,
    live: (patch) => {
      if (patch.straighten === undefined || !W) return ed.live(patch);
      ed.live(withStraighten(latest(), patch.straighten, W, H));
    },
    apply: (patch, label) => {
      if (patch.straighten === undefined || !W) return ed.apply(patch, label);
      ed.apply(withStraighten(latest(), patch.straighten, W, H), label);
    },
  };
  const setAspect = async (value: string) => {
    if (!W) return;
    let aspect = value;
    if (value === 'custom') {
      const input = await promptDialog({ title: t('Custom aspect ratio'), message: t('Width : height, e.g. 7:5'), defaultValue: '7:5' });
      if (!input) return;
      aspect = sanitizeAspect(input);
      if (aspect === 'original' && input.trim().toLowerCase() !== 'original') {
        toast.error(t('Invalid aspect ratio'));
        return;
      }
    }
    ed.apply(withAspect(latest(), aspect, W, H) as DevelopSettings, t('Crop'));
  };
  const options: { value: string; label: string }[] = ASPECT_PRESETS.map((a) => ({ value: a as string, label: aspectLabel(a, t) }));
  if (!ASPECT_PRESETS.includes(s.cropAspect as (typeof ASPECT_PRESETS)[number])) options.push({ value: s.cropAspect, label: aspectLabel(s.cropAspect, t) });
  options.push({ value: 'custom', label: t('Custom…') });
  return (
    <Section title={t('Transform & Crop')} defaultOpen={false} onReset={() => resetSection(photo.id, SECTION_GROUPS.transform, `${t('Reset')} ${t('Crop')}`)}>
      <div className="dv-row">
        <Button size="sm" icon={Crop} variant={cropMode ? 'primary' : 'default'} onClick={() => setStore({ cropMode: !cropMode, tool: 'none' })} title={`${t('Crop overlay')} (R)`}>
          {cropMode ? t('Done') : t('Crop')}
        </Button>
        <IconButton icon={Ruler} size="sm" label={t('Straighten tool — draw a line along the horizon')} active={tool === 'level'} onClick={() => setStore({ tool: tool === 'level' ? 'none' : 'level' })} />
        <span className="spacer" />
        <IconButton icon={RotateCcw} size="sm" label={`${t('Rotate left')} (Ctrl+[)`} onClick={() => rotatePhotos([photo.id], -1)} />
        <IconButton icon={RotateCw} size="sm" label={`${t('Rotate right')} (Ctrl+])`} onClick={() => rotatePhotos([photo.id], 1)} />
        <IconButton icon={FlipHorizontal2} size="sm" label={t('Flip horizontal')} onClick={() => flipPhotos([photo.id], 'h')} />
        <IconButton icon={FlipVertical2} size="sm" label={t('Flip vertical')} onClick={() => flipPhotos([photo.id], 'v')} />
      </div>
      <div className="dv-row">
        <span className="dv-subhead" style={{ margin: 0, minWidth: 48 }}>
          {t('Aspect')}
        </span>
        <Select<string> small value={s.cropAspect} options={options} onChange={(v) => void setAspect(v)} style={{ flex: 1 }} disabled={!W} />
        <IconButton icon={ArrowLeftRight} size="sm" label={`${t('Swap portrait / landscape')} (X)`} onClick={() => swapAspect(photo)} disabled={!W} />
      </div>
      <ParamSlider k="straighten" value={s.straighten} editor={straightenEditor} />
      <div className="dv-row">
        <span className="dv-subhead" style={{ margin: 0, minWidth: 48 }}>
          {t('Overlay')}
        </span>
        <Select<OverlayGrid>
          small
          value={overlay}
          style={{ flex: 1 }}
          onChange={(v) => setStore({ overlay: v })}
          options={[
            { value: 'thirds', label: t('Rule of thirds') },
            { value: 'grid', label: t('Grid') },
            { value: 'golden', label: t('Golden ratio') },
            { value: 'none', label: t('None') },
          ]}
        />
      </div>
      {geo && (
        <span className="dv-hint">
          {t('Output size')}: {geo.outW} × {geo.outH} px ({((geo.outW * geo.outH) / 1e6).toFixed(1)} MP)
        </span>
      )}
    </Section>
  );
}
