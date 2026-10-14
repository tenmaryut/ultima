import { Pipette, Wand } from 'lucide-react';
import { useT } from '../../../core/i18n';
import { Button, IconButton, Segmented } from '../../../components/ui';
import { SECTION_GROUPS, type NumericKey } from '../params';
import { autoToneFor, autoWhiteBalance, resetSection } from '../ops';
import { setStore, useDevelop } from '../store';
import type { Photo } from '../types';
import { editorFor, ParamSlider, Section } from './common';

const TEMP_TRACK = 'linear-gradient(to right, #4a78d8, #9aa4b8 50%, #e2b33c)';
const TINT_TRACK = 'linear-gradient(to right, #3fae4f, #a7a7a7 50%, #c552c9)';

function Sliders({ photo, keys, disabled }: { photo: Photo; keys: NumericKey[]; disabled?: (k: NumericKey) => boolean }) {
  const ed = editorFor(photo);
  return (
    <>
      {keys.map((k) => (
        <ParamSlider key={k} k={k} value={photo.settings[k]} editor={ed} disabled={disabled?.(k)} />
      ))}
    </>
  );
}

export function BasicPanel({ photo }: { photo: Photo }) {
  const t = useT();
  const tool = useDevelop((s) => s.tool);
  const ed = editorFor(photo);
  const s = photo.settings;
  const bw = s.treatment === 'bw';
  return (
    <Section title={t('Basic')} onReset={() => resetSection(photo.id, SECTION_GROUPS.basic, `${t('Reset')} ${t('Basic')}`)}>
      <div className="dv-row" style={{ justifyContent: 'space-between' }}>
        <span className="dv-subhead" style={{ margin: 0 }}>
          {t('Treatment')}
        </span>
        <Segmented
          value={s.treatment}
          options={[
            { value: 'color', label: t('Color') },
            { value: 'bw', label: t('Black & White') },
          ]}
          onChange={(v) => ed.apply({ treatment: v }, t('Treatment'))}
        />
      </div>
      <div className="dv-row" style={{ justifyContent: 'space-between' }}>
        <span className="dv-subhead" style={{ margin: 0 }}>
          {t('White Balance')}
        </span>
        <span className="dv-row-tight">
          <IconButton
            icon={Pipette}
            size="sm"
            label={`${t('White balance picker — click a neutral gray')} (W)`}
            active={tool === 'wb'}
            onClick={() => setStore({ tool: tool === 'wb' ? 'none' : 'wb', cropMode: false })}
          />
          <Button size="sm" variant="ghost" onClick={() => void autoWhiteBalance([photo.id])}>
            {t('Auto')}
          </Button>
        </span>
      </div>
      <ParamSlider k="temp" value={s.temp} editor={ed} track={TEMP_TRACK} />
      <ParamSlider k="tint" value={s.tint} editor={ed} track={TINT_TRACK} />
      <div className="dv-row" style={{ justifyContent: 'space-between' }}>
        <span className="dv-subhead" style={{ margin: 0 }}>
          {t('Tone')}
        </span>
        <Button size="sm" variant="ghost" icon={Wand} onClick={() => void autoToneFor([photo.id])} title={`${t('Auto Tone')} (Ctrl+U)`}>
          {t('Auto')}
        </Button>
      </div>
      <Sliders photo={photo} keys={['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks']} />
      <span className="dv-subhead">{t('Presence')}</span>
      <Sliders photo={photo} keys={['texture', 'clarity', 'dehaze', 'vibrance', 'saturation']} disabled={(k) => bw && (k === 'vibrance' || k === 'saturation')} />
    </Section>
  );
}

export function DetailPanel({ photo }: { photo: Photo }) {
  const t = useT();
  return (
    <Section title={t('Detail')} defaultOpen={false} onReset={() => resetSection(photo.id, SECTION_GROUPS.detail, `${t('Reset')} ${t('Detail')}`)}>
      <span className="dv-subhead">{t('Sharpening')}</span>
      <Sliders photo={photo} keys={['sharpenAmount', 'sharpenRadius', 'sharpenDetail', 'sharpenMasking']} disabled={(k) => k !== 'sharpenAmount' && photo.settings.sharpenAmount === 0} />
      <span className="dv-subhead">{t('Noise Reduction')}</span>
      <Sliders photo={photo} keys={['nrLuminance', 'nrDetail', 'nrColor']} disabled={(k) => k === 'nrDetail' && photo.settings.nrLuminance === 0} />
      <span className="dv-hint">{t('Zoom to 100% (Z) to judge sharpening and noise reduction.')}</span>
    </Section>
  );
}

export function EffectsPanel({ photo }: { photo: Photo }) {
  const t = useT();
  const s = photo.settings;
  return (
    <Section title={t('Effects')} defaultOpen={false} onReset={() => resetSection(photo.id, SECTION_GROUPS.effects, `${t('Reset')} ${t('Effects')}`)}>
      <span className="dv-subhead">{t('Post-Crop Vignetting')}</span>
      <Sliders photo={photo} keys={['vignetteAmount', 'vignetteMidpoint', 'vignetteRoundness', 'vignetteFeather']} disabled={(k) => k !== 'vignetteAmount' && s.vignetteAmount === 0} />
      <span className="dv-subhead">{t('Grain')}</span>
      <Sliders photo={photo} keys={['grainAmount', 'grainSize', 'grainRoughness']} disabled={(k) => k !== 'grainAmount' && s.grainAmount === 0} />
    </Section>
  );
}
