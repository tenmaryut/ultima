import { useId } from 'react';
import type { ProviderId } from '@shared/ai-types';
import { getProviderInfo } from '@shared/providers-catalog';
import { useAISettings } from '../../core/ai/settings';
import { useT } from '../../core/i18n';

/** Free-text model override with suggestions from the provider catalog and the local server. */
export function ModelInput({ providerId, value, onChange, width = 150 }: { providerId: ProviderId | null; value: string; onChange: (v: string) => void; width?: number }) {
  const t = useT();
  const id = useId();
  const statuses = useAISettings((s) => s.statuses);
  const defaults = useAISettings((s) => s.models);
  const catalog = providerId ? (getProviderInfo(providerId)?.models ?? []).map((m) => m.id).filter(Boolean) : [];
  const served = providerId ? (statuses.find((s) => s.id === providerId)?.models ?? []) : [];
  const options = [...new Set([...catalog, ...served])];
  const fallback = providerId ? defaults[providerId] : '';
  return (
    <>
      <input
        className="input sm"
        style={{ width }}
        list={id}
        value={value}
        placeholder={fallback ? t('Model: {name}', { name: fallback }) : t('Default model')}
        title={t('Model override for this chat (leave empty for the default)')}
        aria-label={t('Model')}
        onChange={(e) => onChange(e.target.value.slice(0, 200))}
        disabled={!providerId}
      />
      <datalist id={id}>
        {options.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
    </>
  );
}
