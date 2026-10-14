import { useEffect, useRef, useState } from 'react';
import { Play, Settings2 } from 'lucide-react';
import type { SpeechProviderId, SpeechProviderStatus } from '@shared/ai-types';
import { Button, Field, Modal, Select, Slider, Spinner, TextArea, TextInput, toast } from '../ui';
import { SPEECH_PROVIDERS, preferredVoice, sortVoices, speechProblem, speechStatus, synthesizeSpeech } from '../../core/ai/media';
import { useAISettings } from '../../core/ai/settings';
import { isDesktop } from '../../core/platform';
import { useAppStore } from '../../core/store';
import { useT } from '../../core/i18n';

const MAX_CHARS = 20_000;

/**
 * "Speech from text" for the editors: pick engine, voice and speed, listen, then insert.
 * Engine, voice and speed are remembered in the AI settings.
 */
export function SpeechDialog({
  title,
  confirmLabel,
  hint,
  onInsert,
  onClose,
}: {
  title: string;
  confirmLabel: string;
  /** Where the audio will go, e.g. "Added at the playhead on an audio track." */
  hint?: string;
  onInsert: (file: File) => void | Promise<void>;
  onClose: () => void;
}) {
  const t = useT();
  const language = useAppStore((s) => s.language);
  const provider = useAISettings((s) => s.speechProvider);
  const voices = useAISettings((s) => s.speechVoices);
  const rate = useAISettings((s) => s.speechRate);
  const update = useAISettings((s) => s.update);
  const [statuses, setStatuses] = useState<SpeechProviderStatus[] | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<'preview' | 'insert' | null>(null);
  const [preview, setPreview] = useState<{ key: string; file: File; url: string } | null>(null);
  const previewRef = useRef(preview);
  previewRef.current = preview;

  useEffect(() => {
    if (isDesktop) void speechStatus().then(setStatuses, () => setStatuses([]));
    return () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current.url);
    };
  }, []);

  const status = statuses?.find((s) => s.id === provider);
  const voiceList = sortVoices(status?.voices ?? [], language);
  const chosen = voices[provider] ?? '';
  const voice = chosen || (provider === 'custom' ? '' : preferredVoice(voiceList, language));
  const autoName = voiceList.find((v) => v.id === preferredVoice(voiceList, language))?.name;
  const problem = isDesktop ? speechProblem(t, status) : t('Text to speech needs the Ultima desktop app.');
  const key = JSON.stringify([text.trim(), provider, voice, rate]);

  const make = async (): Promise<File> => {
    if (preview?.key === key) return preview.file;
    const file = await synthesizeSpeech(text.trim(), { provider, voice, rate });
    if (preview) URL.revokeObjectURL(preview.url);
    setPreview({ key, file, url: URL.createObjectURL(file) });
    return file;
  };

  const run = async (mode: 'preview' | 'insert') => {
    if (!text.trim() || busy) return;
    setBusy(mode);
    try {
      const file = await make();
      if (mode === 'insert') {
        await onInsert(file);
        onClose();
      }
    } catch (error) {
      toast.error(t('Speech generation failed.'), error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const ready = Boolean(text.trim()) && !problem && Boolean(statuses);

  return (
    <Modal
      title={title}
      onClose={onClose}
      width={560}
      footer={
        <>
          <Button
            variant="ghost"
            icon={Settings2}
            onClick={() => {
              onClose();
              useAppStore.getState().setActiveModule('settings');
            }}
          >
            {t('Speech settings')}
          </Button>
          <span className="spacer" />
          <Button icon={busy === 'preview' ? undefined : Play} disabled={!ready || Boolean(busy)} onClick={() => void run('preview')}>
            {busy === 'preview' && <Spinner size={12} />}
            {t('Listen')}
          </Button>
          <Button variant="primary" disabled={!ready || Boolean(busy)} onClick={() => void run('insert')}>
            {busy === 'insert' && <Spinner size={12} />}
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="col" style={{ gap: 10 }}>
        <Field label={t('Text')} hint={`${text.length.toLocaleString()} / ${MAX_CHARS.toLocaleString()}`}>
          <TextArea rows={6} autoFocus value={text} maxLength={MAX_CHARS} placeholder={t('Type or paste the text to read aloud…')} onChange={(e) => setText(e.target.value)} />
        </Field>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label={t('Engine')}>
            <Select<SpeechProviderId> small value={provider} onChange={(v) => update({ speechProvider: v })} options={SPEECH_PROVIDERS.map((p) => ({ value: p.id, label: t(p.name) }))} />
          </Field>
          <Field label={t('Voice')}>
            {provider === 'custom' ? (
              <TextInput small value={chosen} placeholder={t('Passed as {voice}')} onChange={(e) => update({ speechVoices: { ...voices, custom: e.target.value } })} />
            ) : (
              <Select
                small
                value={chosen}
                disabled={!status?.available}
                style={{ maxWidth: 240 }}
                onChange={(v) => update({ speechVoices: { ...voices, [provider]: v } })}
                options={[
                  { value: '', label: autoName ? t('Automatic ({voice})', { voice: autoName }) : t('Automatic') },
                  ...voiceList.map((v) => ({ value: v.id, label: v.language ? `${v.name} · ${v.language}` : v.name })),
                ]}
              />
            )}
          </Field>
          <div style={{ width: 170 }}>
            <Slider label={t('Speed')} value={rate} min={0.5} max={2} step={0.05} defaultValue={1} format={(v) => `${v.toFixed(2)}×`} onChange={(v) => update({ speechRate: v })} />
          </div>
        </div>
        {isDesktop && !statuses && (
          <div className="row muted">
            <Spinner size={14} /> {t('Looking for voices…')}
          </div>
        )}
        {problem && <div className="card" style={{ padding: 10, borderColor: 'color-mix(in srgb, var(--warning) 45%, transparent)' }}>{problem}</div>}
        {preview && <audio controls autoPlay src={preview.url} style={{ width: '100%', height: 34 }} />}
        {hint && <span className="faint" style={{ fontSize: 12 }}>{hint}</span>}
      </div>
    </Modal>
  );
}
