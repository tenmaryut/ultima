import { useEffect, useRef, useState } from 'react';
import { Copy } from 'lucide-react';
import type { ImageProviderId } from '@shared/ai-types';
import { IMAGE_PROVIDERS, imageProviderInfo } from '../../../core/ai/media';
import { useT } from '../../../core/i18n';
import { desktop } from '../../../core/platform';
import { useAISettings } from '../../../core/ai/settings';
import { useAppStore } from '../../../core/store';
import { Button, Field, Modal, NumberField, Select, Slider, Spinner, TextArea, toast } from '../../../components/ui';
import { describeImage, generateImage, generativeFill, type Description } from '../aiTools';
import type { PhotoEngine } from '../engine';

function SdNote() {
  const t = useT();
  const sdUrl = useAISettings((s) => s.sdUrl);
  return (
    <div className="faint" style={{ fontSize: 12 }}>
      {t('Uses your local Stable Diffusion WebUI (AUTOMATIC1111 / Forge, started with --api) at {url}.', { url: sdUrl })}{' '}
      {!desktop && t('In the browser version the WebUI must also allow this page (--cors-allow-origins=*).')}{' '}
      <button type="button" className="ph-link" onClick={() => useAppStore.getState().setActiveModule('settings')}>
        {t('Settings')}
      </button>
    </div>
  );
}

export function GenFillDialog({ engine, onClose }: { engine: PhotoEngine; onClose: () => void }) {
  const t = useT();
  const [prompt, setPrompt] = useState('');
  const [negative, setNegative] = useState('blurry, low quality, watermark, text');
  const [strength, setStrength] = useState(90);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    await generativeFill(engine, prompt.trim(), negative.trim(), strength / 100);
    setBusy(false);
    onClose();
  };
  return (
    <Modal
      title={t('Generative Fill')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancel')}</Button>
          <Button variant="primary" disabled={busy} onClick={() => void go()}>
            {busy ? <Spinner size={13} /> : null}
            {t('Generate')}
          </Button>
        </>
      }
    >
      <Field label={t('Describe what should appear in the selection (leave empty to remove the content)')}>
        <TextArea rows={3} value={prompt} autoFocus placeholder={t('e.g. a red hot air balloon')} onChange={(e) => setPrompt(e.target.value)} />
      </Field>
      <Field label={t('Avoid')}>
        <TextArea rows={2} value={negative} onChange={(e) => setNegative(e.target.value)} />
      </Field>
      <Slider label={t('Strength')} value={strength} min={10} max={100} onChange={setStrength} format={(v) => `${v}%`} />
      <SdNote />
    </Modal>
  );
}

export function GenerateDialog({ engine, onClose }: { engine: PhotoEngine; onClose: () => void }) {
  const t = useT();
  const doc = engine.doc;
  const fit = (v: number) => Math.max(256, Math.min(1024, Math.round(v / 8) * 8));
  const ratio = doc ? doc.width / doc.height : 1;
  const [prompt, setPrompt] = useState('');
  const [negative, setNegative] = useState('blurry, low quality, watermark, text');
  const [w, setW] = useState(fit(ratio >= 1 ? 1024 : 1024 * ratio));
  const [h, setH] = useState(fit(ratio >= 1 ? 1024 / ratio : 1024));
  const [steps, setSteps] = useState(25);
  const [busy, setBusy] = useState(false);
  const provider = useAISettings((s) => (desktop || s.imageProvider === 'svg' ? s.imageProvider : 'sd-webui'));
  const updateSettings = useAISettings((s) => s.update);
  const advanced = imageProviderInfo(provider).advanced;
  const go = async () => {
    if (!prompt.trim()) {
      toast.info(t('Describe the image first'));
      return;
    }
    setBusy(true);
    await generateImage(engine, prompt.trim(), advanced ? negative.trim() : '', w, h, steps);
    setBusy(false);
    onClose();
  };
  return (
    <Modal
      title={t('Generate Image')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancel')}</Button>
          <Button variant="primary" disabled={busy} onClick={() => void go()}>
            {busy ? <Spinner size={13} /> : null}
            {t('Generate')}
          </Button>
        </>
      }
    >
      <Field label={t('Generator')}>
        <Select<ImageProviderId>
          value={provider}
          onChange={(v) => updateSettings({ imageProvider: v })}
          options={IMAGE_PROVIDERS.filter((p) => desktop || !p.desktopOnly || p.id === 'sd-webui').map((p) => ({ value: p.id, label: t(p.name) }))}
        />
      </Field>
      <Field label={t('Prompt')}>
        <TextArea rows={3} value={prompt} autoFocus placeholder={t('e.g. a cozy cabin in a snowy forest at dusk, cinematic light')} onChange={(e) => setPrompt(e.target.value)} />
      </Field>
      {advanced && (
        <Field label={t('Avoid')}>
          <TextArea rows={2} value={negative} onChange={(e) => setNegative(e.target.value)} />
        </Field>
      )}
      <div className="row">
        <Field label={t('Width')}>
          <NumberField value={w} min={64} max={2048} step={8} suffix="px" onChange={(v) => setW(Math.round(v / 8) * 8)} />
        </Field>
        <Field label={t('Height')}>
          <NumberField value={h} min={64} max={2048} step={8} suffix="px" onChange={(v) => setH(Math.round(v / 8) * 8)} />
        </Field>
        {advanced && (
          <Field label={t('Steps')}>
            <NumberField value={steps} min={1} max={150} onChange={(v) => setSteps(Math.round(v))} />
          </Field>
        )}
      </div>
      <div className="faint" style={{ fontSize: 12 }}>
        {doc ? t('The result is added as a new layer.') : t('The result opens as a new document.')}
      </div>
      {provider === 'sd-webui' ? (
        <SdNote />
      ) : (
        <div className="faint" style={{ fontSize: 12 }}>
          {t(imageProviderInfo(provider).note)}{' '}
          {provider === 'codex' && t('Codex picks the closest shape: square, landscape or portrait.')}
          {provider === 'antigravity' && t('Antigravity picks the closest aspect ratio.')}{' '}
          <button type="button" className="ph-link" onClick={() => useAppStore.getState().setActiveModule('settings')}>
            {t('Settings')}
          </button>
        </div>
      )}
    </Modal>
  );
}

export function DescribeDialog({ engine, onClose }: { engine: PhotoEngine; onClose: () => void }) {
  const t = useT();
  const [text, setText] = useState('');
  const [result, setResult] = useState<Description | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    abort.current = ctrl;
    describeImage(engine, setText, ctrl.signal)
      .then(setResult)
      .catch((e: unknown) => !ctrl.signal.aborted && setError(e instanceof Error ? e.message : String(e)));
    return () => ctrl.abort();
  }, [engine]);
  const copy = (value: string) => {
    void navigator.clipboard
      ?.writeText(value)
      .then(() => toast.success(t('Copied')))
      .catch(() => toast.error(t('Could not copy')));
  };
  return (
    <Modal title={t('Describe / Alt Text')} onClose={onClose} footer={<Button onClick={onClose}>{t('Close')}</Button>}>
      {error ? (
        <div className="ai-msg error selectable" style={{ whiteSpace: 'pre-wrap' }}>
          {error}
        </div>
      ) : result ? (
        <>
          <Field label={t('Alt text')}>
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <div className="code-block grow">{result.alt}</div>
              <Button size="sm" icon={Copy} onClick={() => copy(result.alt)}>
                {t('Copy')}
              </Button>
            </div>
          </Field>
          <Field label={t('Description')}>
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <div className="code-block grow">{result.description}</div>
              <Button size="sm" icon={Copy} onClick={() => copy(result.description)}>
                {t('Copy')}
              </Button>
            </div>
          </Field>
        </>
      ) : (
        <div className="col">
          <div className="row muted">
            <Spinner size={14} /> {t('Looking at the image…')}
          </div>
          {text && <div className="code-block">{text}</div>}
        </div>
      )}
    </Modal>
  );
}
