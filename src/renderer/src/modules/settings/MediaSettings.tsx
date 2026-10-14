import { useEffect, useState } from 'react';
import { ExternalLink, FolderOpen, Save } from 'lucide-react';
import type { ImageProviderId, SpeechProviderId, SpeechProviderStatus } from '@shared/ai-types';
import { useT } from '../../core/i18n';
import { useAISettings } from '../../core/ai/settings';
import { IMAGE_PROVIDERS, SPEECH_PROVIDERS, checkImageProvider, imageProviderInfo, speechStatus, type ImageCheck } from '../../core/ai/media';
import { desktop, openExternal } from '../../core/platform';
import { Badge, Button, Field, Slider, Spinner, TextInput, promptDialog, toast, Select } from '../../components/ui';
import { DefaultableProviderPicker } from '../../components/ai/ProviderPicker';

const PIPER_VOICES = 'https://huggingface.co/rhasspy/piper-voices/tree/main';

export function ImageGenerationSettings() {
  const t = useT();
  const provider = useAISettings((s) => s.imageProvider);
  const sdUrl = useAISettings((s) => s.sdUrl);
  const comfyUrl = useAISettings((s) => s.comfyUrl);
  const comfyModel = useAISettings((s) => s.comfyModel);
  const localImageUrl = useAISettings((s) => s.localImageUrl);
  const localImageModel = useAISettings((s) => s.localImageModel);
  const svgProvider = useAISettings((s) => s.svgProvider);
  const update = useAISettings((s) => s.update);
  const [check, setCheck] = useState<ImageCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const info = imageProviderInfo(provider);
  const options = IMAGE_PROVIDERS.filter((p) => desktop || !p.desktopOnly || p.id === 'sd-webui');

  useEffect(() => setCheck(null), [provider]);

  const run = async () => {
    setChecking(true);
    try {
      if (!desktop && provider === 'sd-webui') {
        const res = await fetch(`${sdUrl.replace(/\/+$/, '')}/sdapi/v1/sd-models`, { signal: AbortSignal.timeout(3000) });
        setCheck(res.ok ? { ok: true, models: [] } : { ok: false, error: res.statusText });
      } else setCheck(await checkImageProvider(provider));
    } catch (error) {
      setCheck({ ok: false, error: error instanceof Error ? error.message : String(error) });
    } finally {
      setChecking(false);
    }
  };

  const models = check?.ok ? check.models : [];
  const modelInput = (value: string, onChange: (v: string) => void, placeholder: string) => (
    <Field label={t('Model')}>
      <TextInput small list="ultima-image-models" style={{ maxWidth: 320 }} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      <datalist id="ultima-image-models">
        {models.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
    </Field>
  );

  return (
    <section className="card col" style={{ gap: 12 }}>
      <h2 className="section-title">{t('Image generation')}</h2>
      <div className="muted">
        {t('Used by AI Studio → Images and Photo → Generate Image. Choose a free generator on your own computer, or Codex to use the image allowance of your ChatGPT plan.')}
      </div>
      <Field label={t('Generator')}>
        <Select<ImageProviderId>
          value={provider}
          onChange={(v) => update({ imageProvider: v })}
          options={options.map((p) => ({ value: p.id, label: t(p.name) }))}
          style={{ maxWidth: 320 }}
        />
      </Field>
      <span className="muted" style={{ fontSize: 12 }}>
        {t(info.note)}
      </span>
      {provider === 'sd-webui' && (
        <Field label={t('Address')}>
          <TextInput small style={{ maxWidth: 320 }} value={sdUrl} onChange={(e) => update({ sdUrl: e.target.value })} />
        </Field>
      )}
      {provider === 'comfyui' && (
        <>
          <Field label={t('Address')}>
            <TextInput small style={{ maxWidth: 320 }} value={comfyUrl} onChange={(e) => update({ comfyUrl: e.target.value })} />
          </Field>
          {modelInput(comfyModel, (v) => update({ comfyModel: v }), t('First checkpoint'))}
        </>
      )}
      {provider === 'local-openai' && (
        <>
          <Field label={t('Address')}>
            <TextInput small style={{ maxWidth: 320 }} value={localImageUrl} onChange={(e) => update({ localImageUrl: e.target.value })} />
          </Field>
          {modelInput(localImageModel, (v) => update({ localImageModel: v }), t('e.g. flux.1-dev-ggml'))}
        </>
      )}
      {provider === 'codex' && (
        <span className="muted" style={{ fontSize: 12 }}>
          {t('Every image counts against the limits of your ChatGPT plan. Codex also keeps a copy in its own folder (~/.codex/generated_images).')}
        </span>
      )}
      {provider === 'antigravity' && (
        <span className="muted" style={{ fontSize: 12 }}>
          {t('Every image counts against the quota of your Google AI plan; Antigravity keeps a copy with the conversation (~/.gemini). When the quota runs out it only spends AI credits if you turned on “Use AI Credits” in agy.')}
        </span>
      )}
      {provider === 'svg' && (
        <Field label={t('AI that draws')}>
          <DefaultableProviderPicker value={svgProvider} onChange={(id) => update({ svgProvider: id })} />
        </Field>
      )}
      {provider !== 'sd-webui' && (
        <span className="faint" style={{ fontSize: 12 }}>
          {t('Generative fill in Photo paints into a selection and always uses Stable Diffusion WebUI.')}
        </span>
      )}
      <div className="row">
        <Button size="sm" onClick={() => void run()} disabled={checking}>
          {checking && <Spinner size={12} />}
          {t('Check')}
        </Button>
        {check?.ok && <Badge tone="ok">{t('Ready')}</Badge>}
        {check?.ok && models.length > 0 && <span className="faint">{t('{count} models', { count: models.length })}</span>}
        {check && !check.ok && <Badge tone="err">{t('Not ready')}</Badge>}
      </div>
      {check && !check.ok && <pre className="code-block" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{check.error}</pre>}
    </section>
  );
}

function statusBadge(t: ReturnType<typeof useT>, status: SpeechProviderStatus | undefined) {
  if (!status) return null;
  if (status.available) return <Badge tone="ok">{t('Ready')}</Badge>;
  if (status.detail === 'no-model') return <Badge tone="warn">{t('Choose a voice')}</Badge>;
  if (status.detail === 'not-configured') return <Badge>{t('Not set up')}</Badge>;
  return <Badge>{t('Not installed')}</Badge>;
}

export function SpeechSettings() {
  const t = useT();
  const provider = useAISettings((s) => s.speechProvider);
  const rate = useAISettings((s) => s.speechRate);
  const update = useAISettings((s) => s.update);
  const [statuses, setStatuses] = useState<SpeechProviderStatus[] | null>(null);
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');

  const reload = () => void speechStatus(true).then(setStatuses, () => setStatuses([]));

  useEffect(() => {
    if (!desktop) return;
    reload();
    void desktop.tools.speechConfig().then((c) => {
      setCommand(c.custom?.command ?? '');
      setArgs((c.custom?.args ?? []).map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' '));
    });
  }, []);

  if (!desktop) {
    return (
      <section className="card col" style={{ gap: 12 }}>
        <h2 className="section-title">{t('Speech (text to speech)')}</h2>
        <div className="muted">{t('Text to speech needs the Ultima desktop app.')}</div>
      </section>
    );
  }

  const status = (id: SpeechProviderId) => statuses?.find((s) => s.id === id);
  const system = status('system');
  const piper = status('piper');
  const custom = status('custom');

  const saveCustom = async () => {
    const parsed = (args.match(/"[^"]*"|\S+/g) ?? []).map((a) => (a.startsWith('"') ? a.slice(1, -1) : a));
    if (command.trim() && !parsed.some((a) => a.includes('{output}'))) {
      toast.error(t('Add {output} to the arguments'), t('The program must write the audio to the file Ultima passes as {output}.'));
      return;
    }
    const ok = await desktop!.tools.setSpeechCustom(command.trim() ? { command: command.trim(), args: parsed } : null);
    if (ok) {
      toast.success(t('Custom command saved'));
      reload();
    }
  };

  return (
    <section className="card col" style={{ gap: 12 }}>
      <h2 className="section-title">{t('Speech (text to speech)')}</h2>
      <div className="muted">{t('Turn text into a voice-over in AI Studio → Speech, Audio and Video. Everything runs on your computer and is free.')}</div>
      <div className="row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field label={t('Engine')}>
          <Select<SpeechProviderId> value={provider} onChange={(v) => update({ speechProvider: v })} options={SPEECH_PROVIDERS.map((p) => ({ value: p.id, label: t(p.name) }))} />
        </Field>
        <div style={{ width: 240 }}>
          <Slider label={t('Speed')} value={rate} min={0.5} max={2} step={0.05} defaultValue={1} format={(v) => `${v.toFixed(2)}×`} onChange={(v) => update({ speechRate: v })} />
        </div>
        {!statuses && <Spinner size={14} />}
      </div>

      <div className="provider-row">
        <div className="col" style={{ gap: 4 }}>
          <div className="row">
            <strong style={{ color: 'var(--text-0)' }}>{t('System voices')}</strong>
            {statusBadge(t, system)}
          </div>
          <span className="muted" style={{ fontSize: 12 }}>
            {t('The voices built into your operating system (macOS say, Windows SAPI, Linux espeak-ng). Install more voices in your system settings.')}
          </span>
          {system?.available && <span className="faint">{t('{count} voices', { count: system.voices.length })}</span>}
          {system && !system.available && <code className="code-block" style={{ padding: '4px 8px' }}>sudo apt install espeak-ng</code>}
        </div>
      </div>

      <div className="provider-row">
        <div className="col" style={{ gap: 4 }}>
          <div className="row">
            <strong style={{ color: 'var(--text-0)' }}>Piper</strong>
            {statusBadge(t, piper)}
          </div>
          <span className="muted" style={{ fontSize: 12 }}>
            {t('Natural-sounding neural voices that run offline, including Indonesian (id_ID-news_tts). Download a voice (.onnx and .onnx.json) and choose the .onnx file. Check each voice’s license before commercial use.')}
          </span>
          {piper?.detail === 'not-installed' && <code className="code-block" style={{ padding: '4px 8px' }}>pip install piper-tts</code>}
          {piper?.available && <span className="faint mono" style={{ fontSize: 11 }}>{piper.detail}</span>}
          <a href="#" onClick={(e) => (e.preventDefault(), openExternal(PIPER_VOICES))} style={{ fontSize: 12 }}>
            {t('Download Piper voices')} <ExternalLink size={11} />
          </a>
        </div>
        <div className="col" style={{ alignItems: 'flex-end', gap: 6 }}>
          <Button
            size="sm"
            icon={FolderOpen}
            onClick={async () => {
              if (await desktop!.tools.pickPiperModel()) reload();
            }}
          >
            {t('Choose voice…')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              const cmd = await promptDialog({ title: 'Piper', message: t('Program name or full path'), defaultValue: '' });
              if (cmd === null) return;
              if (await desktop!.tools.setCommand('piper', cmd.trim() || null)) reload();
            }}
          >
            {t('Set path')}
          </Button>
        </div>
      </div>

      <div className="provider-row">
        <div className="col" style={{ gap: 6 }}>
          <div className="row">
            <strong style={{ color: 'var(--text-0)' }}>{t('Custom command')}</strong>
            {statusBadge(t, custom)}
          </div>
          <span className="muted" style={{ fontSize: 12 }}>
            {t('Any text-to-speech program. Placeholders: {text_file} (the text, UTF-8), {output} (where to write the audio), {voice} and {rate}. The text is also sent on standard input.')}
          </span>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <TextInput small style={{ width: 170 }} placeholder={t('Program, e.g. espeak-ng')} value={command} onChange={(e) => setCommand(e.target.value)} />
            <TextInput small style={{ width: 320 }} placeholder="-v {voice} -f {text_file} -w {output}" value={args} onChange={(e) => setArgs(e.target.value)} />
          </div>
        </div>
        <div className="col" style={{ alignItems: 'flex-end' }}>
          <Button size="sm" icon={Save} onClick={() => void saveCustom()}>
            {t('Save')}
          </Button>
        </div>
      </div>
    </section>
  );
}
