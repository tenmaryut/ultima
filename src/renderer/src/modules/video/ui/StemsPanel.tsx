import { useState } from 'react';
import { AudioLines } from 'lucide-react';
import type { Clip } from '../types';
import { useT } from '../../../core/i18n';
import { useAISettings } from '../../../core/ai/settings';
import { Button, Field, Panel, Select } from '../../../components/ui';
import { STEMS, type StemKind } from '../stems';
import type { StemEngine, StemsApi } from '../useStems';

/* Splitting a clip's sound: without vocals (karaoke), vocals only, drums only, or without drums. */

export function StemsPanel({ clip, stems }: { clip: Clip; stems: StemsApi }) {
  const t = useT();
  const [stem, setStem] = useState<StemKind>('instrumental');
  const [engine, setEngine] = useState<StemEngine>('auto');
  const demucs = useAISettings((s) => s.tools.find((x) => x.id === 'demucs')?.available);
  return (
    <Panel title={t('Separate the sound (stems)')} defaultOpen={false}>
      <Field label={t('Keep')}>
        <Select<string> small value={stem} onChange={(v) => setStem(v as StemKind)} options={STEMS.map((s) => ({ value: s.id, label: t(s.label) }))} />
      </Field>
      <Field label={t('Engine')}>
        <Select<string>
          small
          value={engine}
          onChange={(v) => setEngine(v as StemEngine)}
          options={[
            { value: 'auto', label: demucs ? t('Automatic (Demucs)') : t('Automatic (built-in)') },
            { value: 'builtin', label: t('Built-in (fast)') },
            { value: 'demucs', label: demucs ? t('Demucs (best)') : t('Demucs (not installed)'), disabled: !demucs },
          ]}
        />
      </Field>
      <Button icon={AudioLines} disabled={Boolean(stems.job)} onClick={() => void stems.split(clip.id, stem, engine)}>
        {t('Separate')}
      </Button>
      <div className="vd-hint">
        {t('Adds the part you keep as a new audio clip in sync and mutes the original sound. The built-in separation works best on stereo music; Demucs (free, Settings → Local creative tools) is cleaner.')}
      </div>
    </Panel>
  );
}
