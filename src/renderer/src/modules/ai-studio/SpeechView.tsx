import { useEffect, useRef, useState } from 'react';
import { AudioLines, Clapperboard, Download, RefreshCw, Settings2, Square, Trash2, Volume2 } from 'lucide-react';
import type { SpeechProviderId, SpeechProviderStatus } from '@shared/ai-types';
import { Button, Field, IconButton, Select, Slider, Spinner, TextArea, TextInput, toast } from '../../components/ui';
import { AUDIO_EXTENSIONS, SPEECH_PROVIDERS, preferredVoice, sortVoices, speechProblem, speechStatus, synthesizeSpeech } from '../../core/ai/media';
import { useAISettings } from '../../core/ai/settings';
import { isDesktop, openExternal, saveFile } from '../../core/platform';
import { useAppStore } from '../../core/store';
import { uid } from '../../core/utils/id';
import { useT } from '../../core/i18n';

const MAX_CHARS = 20_000;

interface Clip {
  id: string;
  url: string;
  file: File;
  text: string;
  voice: string;
  rate: number;
}

/** Text to speech with the engines from Settings → Speech; clips go to Audio or Video. */
export function SpeechView({ active }: { active: boolean }) {
  const t = useT();
  const language = useAppStore((s) => s.language);
  const provider = useAISettings((s) => s.speechProvider);
  const voices = useAISettings((s) => s.speechVoices);
  const rate = useAISettings((s) => s.speechRate);
  const update = useAISettings((s) => s.update);
  const [statuses, setStatuses] = useState<SpeechProviderStatus[] | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [clips, setClips] = useState<Clip[]>([]);
  const clipsRef = useRef(clips);
  clipsRef.current = clips;

  useEffect(() => () => clipsRef.current.forEach((c) => URL.revokeObjectURL(c.url)), []);

  const load = (force = false) => {
    if (!isDesktop) return;
    setStatuses(null);
    void speechStatus(force).then(setStatuses, () => setStatuses([]));
  };
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    if (active) loadRef.current();
  }, [active]);

  const status = statuses?.find((s) => s.id === provider);
  const voiceList = sortVoices(status?.voices ?? [], language);
  const chosenVoice = voices[provider] ?? '';
  const autoVoice = preferredVoice(voiceList, language);
  const autoName = voiceList.find((v) => v.id === autoVoice)?.name;
  const problem = speechProblem(t, status);
  const setVoice = (voice: string) => update({ speechVoices: { ...voices, [provider]: voice } });

  const generate = async () => {
    const input = text.trim();
    if (!input || busy) return;
    setBusy(true);
    try {
      const voice = chosenVoice || (provider === 'custom' ? '' : autoVoice);
      const file = await synthesizeSpeech(input, { provider, voice, rate });
      const clip: Clip = { id: uid('clip'), url: URL.createObjectURL(file), file, text: input, voice: voiceList.find((v) => v.id === voice)?.name ?? voice, rate };
      setClips((list) => {
        const next = [clip, ...list];
        next.slice(30).forEach((c) => URL.revokeObjectURL(c.url));
        return next.slice(0, 30);
      });
    } catch (error) {
      toast.error(t('Speech generation failed.'), error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  /** Browser version: read the text with the browser's own voice (cannot be saved). */
  const readAloud = () => {
    if (!('speechSynthesis' in window)) return;
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text.trim());
    utterance.lang = language === 'id' ? 'id-ID' : 'en-US';
    utterance.rate = rate;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
    setSpeaking(true);
  };

  const remove = (clip: Clip) => {
    URL.revokeObjectURL(clip.url);
    setClips((list) => list.filter((c) => c.id !== clip.id));
  };

  const ext = (clip: Clip) => AUDIO_EXTENSIONS[clip.file.type] ?? 'wav';

  return (
    <div className="as-images as-images-ready">
      <aside className="as-images-form">
        {isDesktop ? (
          <>
            <Field label={t('Engine')}>
              <Select<SpeechProviderId> small value={provider} onChange={(v) => update({ speechProvider: v })} options={SPEECH_PROVIDERS.map((p) => ({ value: p.id, label: t(p.name) }))} />
            </Field>
            {provider === 'custom' ? (
              <Field label={t('Voice')}>
                <TextInput small value={chosenVoice} placeholder={t('Passed as {voice}')} onChange={(e) => setVoice(e.target.value)} />
              </Field>
            ) : (
              <Field label={t('Voice')}>
                <Select
                  small
                  value={chosenVoice}
                  onChange={setVoice}
                  disabled={!status?.available}
                  options={[
                    { value: '', label: autoName ? t('Automatic ({voice})', { voice: autoName }) : t('Automatic') },
                    ...voiceList.map((v) => ({ value: v.id, label: v.language ? `${v.name} · ${v.language}` : v.name })),
                  ]}
                />
              </Field>
            )}
            {!statuses && (
              <div className="row muted">
                <Spinner size={14} /> {t('Looking for voices…')}
              </div>
            )}
            {problem && (
              <div className="card col" style={{ gap: 8, padding: 10, borderColor: 'color-mix(in srgb, var(--warning) 45%, transparent)' }}>
                <span>{problem}</span>
                <div className="row" style={{ gap: 6 }}>
                  <Button size="sm" icon={Settings2} onClick={() => useAppStore.getState().setActiveModule('settings')}>
                    {t('Open Settings')}
                  </Button>
                  <Button size="sm" variant="ghost" icon={RefreshCw} onClick={() => load(true)}>
                    {t('Check again')}
                  </Button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="muted" style={{ fontSize: 12.5 }}>
            {t('The browser version can read text aloud with your browser’s voice. To save speech as audio for Audio and Video, use the Ultima desktop app.')}{' '}
            <a href="#" onClick={(e) => (e.preventDefault(), openExternal('https://github.com/tenmaryut/ultima/releases/latest'))}>
              {t('Download desktop app')}
            </a>
          </div>
        )}
        <Slider label={t('Speed')} value={rate} min={0.5} max={2} step={0.05} defaultValue={1} format={(v) => `${v.toFixed(2)}×`} onChange={(v) => update({ speechRate: v })} />
        <Field label={t('Text')} hint={`${text.length.toLocaleString()} / ${MAX_CHARS.toLocaleString()}`}>
          <TextArea rows={10} value={text} maxLength={MAX_CHARS} placeholder={t('Type or paste the text to read aloud…')} onChange={(e) => setText(e.target.value)} />
        </Field>
        {isDesktop ? (
          <Button variant="primary" icon={busy ? undefined : AudioLines} block disabled={!text.trim() || busy || Boolean(problem) || !statuses} onClick={() => void generate()}>
            {busy && <Spinner size={12} />}
            {busy ? t('Creating speech…') : t('Create speech')}
          </Button>
        ) : (
          <Button variant="primary" icon={speaking ? Square : Volume2} block disabled={!text.trim() && !speaking} onClick={readAloud}>
            {speaking ? t('Stop') : t('Read aloud')}
          </Button>
        )}
      </aside>
      <div className="as-gallery">
        {!clips.length && (
          <div className="as-gallery-empty faint">
            {t('Speech clips appear here. Listen, save them as audio files, or send them to Audio and Video as a voice-over.')}
          </div>
        )}
        <div className="as-speech-list">
          {clips.map((clip) => (
            <div key={clip.id} className="as-speech-clip">
              <div className="as-speech-text" title={clip.text}>
                {clip.text}
              </div>
              <audio controls src={clip.url} preload="metadata" />
              <div className="row faint" style={{ fontSize: 11.5, gap: 6, flexWrap: 'wrap' }}>
                <span>{clip.voice || t('Default voice')}</span>
                <span>· {clip.rate.toFixed(2)}×</span>
                <span className="spacer" />
                <Button size="sm" icon={Download} onClick={() => void saveFile(clip.file, { suggestedName: clip.file.name, filters: [{ name: ext(clip).toUpperCase(), extensions: [ext(clip)] }] })}>
                  {ext(clip).toUpperCase()}
                </Button>
                <Button size="sm" icon={AudioLines} onClick={() => useAppStore.getState().sendToModule('audio', { kind: 'files', files: [clip.file] })}>
                  {t('Open in Audio')}
                </Button>
                <Button size="sm" icon={Clapperboard} onClick={() => useAppStore.getState().sendToModule('video', { kind: 'files', files: [clip.file], place: 'playhead' })}>
                  {t('Add to Video')}
                </Button>
                <IconButton icon={Trash2} size="sm" label={t('Remove')} onClick={() => remove(clip)} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
