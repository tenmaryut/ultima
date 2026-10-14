import { PROVIDERS } from '@shared/providers-catalog';
import type { ProviderId } from '@shared/ai-types';
import { useAISettings } from '../../core/ai/settings';
import { useAppStore } from '../../core/store';
import { useT } from '../../core/i18n';
import { Select } from '../ui';

/** Compact select of the AI connections that are installed and enabled. */
export function ProviderPicker({
  value,
  onChange,
  small = true,
}: {
  value: ProviderId | null;
  onChange: (id: ProviderId) => void;
  small?: boolean;
}) {
  const t = useT();
  const statuses = useAISettings((s) => s.statuses);
  const enabled = useAISettings((s) => s.enabled);
  const usable = PROVIDERS.filter((p) => enabled[p.id] && statuses.find((s) => s.id === p.id)?.available);
  return (
    <select
      className={`select ${small ? 'sm' : ''}`}
      style={{ maxWidth: 140 }}
      value={value ?? ''}
      title={t('AI used for this request')}
      onChange={(e) => {
        if (e.target.value === '__settings') {
          useAppStore.getState().setActiveModule('settings');
          return;
        }
        onChange(e.target.value as ProviderId);
      }}
    >
      {!usable.length && <option value="">{t('No AI connected')}</option>}
      {usable.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
      <option value="__settings">{t('Connect more…')}</option>
    </select>
  );
}

/** Select of the connected AIs plus "Default AI" (null), e.g. for the AI that draws SVG images. */
export function DefaultableProviderPicker({ value, onChange }: { value: ProviderId | null; onChange: (id: ProviderId | null) => void }) {
  const t = useT();
  const statuses = useAISettings((s) => s.statuses);
  const enabled = useAISettings((s) => s.enabled);
  const usable = PROVIDERS.filter((p) => enabled[p.id] && statuses.find((s) => s.id === p.id)?.available);
  const options = [{ value: '', label: t('Default AI') }, ...usable.map((p) => ({ value: p.id as string, label: t(p.name) }))];
  if (value && !usable.some((p) => p.id === value)) options.push({ value, label: PROVIDERS.find((p) => p.id === value)?.name ?? value });
  return <Select small value={value ?? ''} onChange={(v) => onChange(v ? (v as ProviderId) : null)} options={options} />;
}
