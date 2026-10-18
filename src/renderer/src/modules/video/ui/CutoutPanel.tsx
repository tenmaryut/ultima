import { useState } from 'react';
import { Layers, Scissors, Trash2 } from 'lucide-react';
import type { Clip, ClipMatte } from '../types';
import { useT } from '../../../core/i18n';
import { Button, Field, IconButton, Panel, Select, Toggle } from '../../../components/ui';
import type { CutoutApi } from '../useCutout';

/* Cutting the subject (a player, a person) out of a video clip — for text behind the player and effects on the
 * background only. */

export function CutoutPanel({ clip, cutout }: { clip: Clip; cutout: CutoutApi }) {
  const t = useT();
  const [model, setModel] = useState<ClipMatte['model']>(clip.matte?.model ?? 'people');
  const m = clip.matte;
  const busy = Boolean(cutout.job);
  return (
    <Panel title={t('Cut out the subject')} defaultOpen={Boolean(m)}>
      <div className="vd-hint">{t('Separates the player or person from the background with rembg on this computer (free; Settings → Local creative tools). It takes a while: about a second per frame.')}</div>
      {!m ? (
        <>
          <Field label={t('What to cut out')}>
            <Select<string>
              small
              value={model}
              onChange={(v) => setModel(v as ClipMatte['model'])}
              options={[
                { value: 'people', label: t('People and players') },
                { value: 'anything', label: t('Anything in front') },
              ]}
            />
          </Field>
          <Button icon={Scissors} disabled={busy || clip.freeze} onClick={() => void cutout.cutOut(clip.id, model)}>
            {t('Cut out the subject')}
          </Button>
        </>
      ) : (
        <>
          <div className="row" style={{ gap: 6 }}>
            <span className="grow muted">{t('Cut out: {count} frames ({model})', { count: m.frames.length, model: m.model === 'people' ? t('people') : t('anything') })}</span>
            <IconButton icon={Trash2} label={t('Remove cut-out')} onClick={() => cutout.remove(clip.id)} />
          </div>
          <Toggle checked={Boolean(m.invert)} onChange={(on) => cutout.invert(clip.id, on)} label={t('Show everything but the subject')} />
          <Button icon={Layers} onClick={() => cutout.inFront(clip.id)}>
            {t('Subject in front of titles')}
          </Button>
          <div className="vd-hint">{t('Text behind the player: puts a copy with only the subject on the top track. Titles on the tracks below pass behind it.')}</div>
        </>
      )}
    </Panel>
  );
}
