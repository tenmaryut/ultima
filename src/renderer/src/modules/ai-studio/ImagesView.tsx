import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Download, ExternalLink, Image as ImageIcon, PenTool, RefreshCw, Settings2, Sparkles, Square, Trash2, Undo2, Wand2 } from 'lucide-react';
import type { ImageProviderId } from '@shared/ai-types';
import { Button, Field, IconButton, NumberField, Select, Slider, Spinner, TextArea, toast } from '../../components/ui';
import { DefaultableProviderPicker } from '../../components/ai/ProviderPicker';
import { describeAIError, runAI } from '../../core/ai/client';
import { IMAGE_PROVIDERS, checkImageProvider, generateImages, imageProviderInfo } from '../../core/ai/media';
import { useAISettings } from '../../core/ai/settings';
import { isDesktop, openExternal, saveFile } from '../../core/platform';
import { useAppStore } from '../../core/store';
import { dataUrlToBlob } from '../../core/utils/base64';
import { uid } from '../../core/utils/id';
import { useT, type TFunction } from '../../core/i18n';
import { copyToClipboard } from './MessageItem';

interface GeneratedImage {
  id: string;
  dataUrl: string;
  mime: string;
  provider: ImageProviderId;
  prompt: string;
  negative: string;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  seed: number | null;
  createdAt: number;
  /** Vector original of an SVG drawing. */
  svg?: string;
}

const SIZES = [
  { value: '512x512', label: '512 × 512 (1:1, SD 1.5)' },
  { value: '768x768', label: '768 × 768 (1:1)' },
  { value: '1024x1024', label: '1024 × 1024 (1:1, SDXL)' },
  { value: '512x768', label: '512 × 768 (2:3 portrait)' },
  { value: '768x512', label: '768 × 512 (3:2 landscape)' },
  { value: '832x1216', label: '832 × 1216 (portrait, SDXL)' },
  { value: '1216x832', label: '1216 × 832 (landscape, SDXL)' },
  { value: '1024x576', label: '1024 × 576 (16:9)' },
  { value: '576x1024', label: '576 × 1024 (9:16)' },
  { value: 'custom', label: 'Custom' },
];

/** Codex's image tool only knows these three shapes. */
const CODEX_SIZES = [
  { value: '1024x1024', label: 'Square (1024 × 1024)' },
  { value: '1536x1024', label: 'Landscape (1536 × 1024)' },
  { value: '1024x1536', label: 'Portrait (1024 × 1536)' },
];

/** Shapes for generators that work in aspect ratios (Antigravity) or draw at any size (SVG). */
const SHAPES = [
  { value: '1024x1024', label: 'Square (1:1)' },
  { value: '1600x900', label: 'Landscape (16:9)' },
  { value: '900x1600', label: 'Portrait (9:16)' },
  { value: '1200x900', label: 'Landscape (4:3)' },
  { value: '1080x1350', label: 'Portrait (4:5)' },
];

const IMPROVE_SD =
  'You are an expert prompt engineer for Stable Diffusion (SD 1.5 / SDXL). Rewrite the user\'s idea as ONE detailed English image generation prompt: subject, composition, lighting, lens or medium, style, color palette, important details and quality tags, comma separated, under 70 words. Reply with the prompt only — no quotes, no explanation.';
const IMPROVE_NATURAL =
  'You are an expert at prompts for modern image generators. Rewrite the user\'s idea as ONE vivid English image description in natural language (2–4 sentences): subject, setting, composition, lighting, style or medium, colors and important details. Reply with the description only — no quotes, no explanation.';

const EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

type Status = 'checking' | 'ok' | 'unreachable' | 'browser';

/** The size the generator really delivered (Codex and some servers pick their own). */
function naturalSize(url: string, fallback: { w: number; h: number }): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth && img.naturalHeight ? { w: img.naturalWidth, h: img.naturalHeight } : fallback);
    img.onerror = () => resolve(fallback);
    img.src = url;
  });
}

function link(label: string, url: string): ReactNode {
  return (
    <a href="#" onClick={(e) => (e.preventDefault(), openExternal(url))}>
      {label} <ExternalLink size={11} />
    </a>
  );
}

function SetupSteps({ provider, address, t }: { provider: ImageProviderId; address: string; t: TFunction }) {
  if (provider === 'comfyui') {
    return (
      <ol className="as-steps">
        <li>
          {t('Install ComfyUI (free, runs on your GPU).')} {link('ComfyUI', 'https://github.com/comfyanonymous/ComfyUI')}
        </li>
        <li>{t('Put a Stable Diffusion checkpoint (.safetensors) into ComfyUI/models/checkpoints.')}</li>
        <li>{t('Start ComfyUI and check its address in Settings → Image generation (now {url}).', { url: address })}</li>
        <li>{t('Come back here and press “Check again”.')}</li>
      </ol>
    );
  }
  if (provider === 'local-openai') {
    return (
      <ol className="as-steps">
        <li>
          {t('Install a local server with an OpenAI-style image endpoint, for example LocalAI (free).')} {link('LocalAI', 'https://localai.io')}
        </li>
        <li>
          {t('Install an image model, for example:')} <code className="as-code">local-ai run flux.1-dev-ggml</code>
        </li>
        <li>{t('Check the address and model in Settings → Image generation (now {url}).', { url: address })}</li>
        <li>{t('Come back here and press “Check again”.')}</li>
      </ol>
    );
  }
  if (provider === 'antigravity') {
    return (
      <ol className="as-steps">
        <li>
          {t('Install Antigravity CLI:')} <code className="as-code">curl -fsSL https://antigravity.google/cli/install.sh | bash</code>{' '}
          {t('(Windows PowerShell: irm https://antigravity.google/cli/install.ps1 | iex)')}
        </li>
        <li>{t('Run “agy” once in a terminal and sign in with the Google account of your Google AI Pro or Ultra plan.')}</li>
        <li>{t('Turn on Antigravity CLI in Settings → AI connections.')}</li>
        <li>{t('Come back here and press “Check again”.')}</li>
      </ol>
    );
  }
  if (provider === 'svg') {
    return (
      <ol className="as-steps">
        <li>{t('Connect an AI in Settings → AI connections — for example Claude Code, Antigravity CLI or a local model.')}</li>
        <li>{t('Come back here and press “Check again”.')}</li>
      </ol>
    );
  }
  if (provider === 'codex') {
    return (
      <ol className="as-steps">
        <li>
          {t('Install Codex CLI:')} <code className="as-code">npm install -g @openai/codex</code>
        </li>
        <li>{t('Run “codex” once in a terminal and sign in with your ChatGPT account (a plan that includes image generation).')}</li>
        <li>{t('Turn on Codex in Settings → AI connections.')}</li>
        <li>{t('Come back here and press “Check again”.')}</li>
      </ol>
    );
  }
  return (
    <ol className="as-steps">
      <li>
        {t('Install AUTOMATIC1111 Stable Diffusion WebUI or Forge (free, runs on your GPU).')}{' '}
        {link('AUTOMATIC1111', 'https://github.com/AUTOMATIC1111/stable-diffusion-webui')} · {link('Forge', 'https://github.com/lllyasviel/stable-diffusion-webui-forge')}
      </li>
      <li>
        {t('Start it with the API enabled:')} <code className="as-code">./webui.sh --api</code> {t('(Windows: add --api to COMMANDLINE_ARGS in webui-user.bat)')}
      </li>
      <li>{t('Check the address in Settings → Image generation (now {url}).', { url: address })}</li>
      <li>{t('Come back here and press “Check again”.')}</li>
    </ol>
  );
}

/** Text-to-image with the generator chosen in Settings → Image generation (desktop app). */
export function ImagesView({ active }: { active: boolean }) {
  const t = useT();
  const provider = useAISettings((s) => s.imageProvider);
  const address = useAISettings((s) => (provider === 'comfyui' ? s.comfyUrl : provider === 'local-openai' ? s.localImageUrl : provider === 'sd-webui' ? s.sdUrl : ''));
  const model = useAISettings((s) => (provider === 'comfyui' ? s.comfyModel : provider === 'local-openai' ? s.localImageModel : ''));
  const codexEnabled = useAISettings((s) => Boolean(s.enabled.codex));
  const update = useAISettings((s) => s.update);
  const svgProvider = useAISettings((s) => s.svgProvider);
  const info = imageProviderInfo(provider);
  const unavailable = !isDesktop && info.desktopOnly;
  const [status, setStatus] = useState<Status>(unavailable ? 'browser' : 'checking');
  const [error, setError] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [prompt, setPrompt] = useState('');
  const [previousPrompt, setPreviousPrompt] = useState<string | null>(null);
  const [negative, setNegative] = useState('blurry, low quality, deformed, watermark, text');
  const [size, setSize] = useState('512x512');
  const [custom, setCustom] = useState({ w: 640, h: 640 });
  const [steps, setSteps] = useState(25);
  const [cfg, setCfg] = useState(7);
  const [seed, setSeed] = useState(-1);
  const [batch, setBatch] = useState(1);
  const [gallery, setGallery] = useState<GeneratedImage[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [improving, setImproving] = useState(false);
  const stopRef = useRef(false);
  const improveAbort = useRef<AbortController | null>(null);

  const check = async () => {
    if (unavailable) {
      setStatus('browser');
      return;
    }
    setStatus('checking');
    const result = await checkImageProvider(provider);
    if (result.ok) {
      setModels(result.models);
      setStatus('ok');
      setError('');
    } else {
      setModels([]);
      setStatus('unreachable');
      setError(result.error);
    }
  };

  const checkRef = useRef(check);
  checkRef.current = check;
  useEffect(() => {
    if (active) void checkRef.current();
  }, [active, provider, address, codexEnabled, svgProvider]);

  const sizeOptions = provider === 'codex' ? CODEX_SIZES : provider === 'antigravity' || provider === 'svg' ? SHAPES : SIZES;
  const chosenSize = sizeOptions.some((s) => s.value === size) ? size : sizeOptions[0].value;
  const [w, h] = chosenSize === 'custom' ? [custom.w, custom.h] : chosenSize.split('x').map(Number);
  const maxBatch = info.advanced || provider === 'local-openai' ? 8 : 4;
  const needsModel = provider === 'local-openai' && !model;

  const setModel = (value: string) => update(provider === 'comfyui' ? { comfyModel: value } : { localImageModel: value });

  const generate = async () => {
    if (unavailable || !prompt.trim() || progress || needsModel) return;
    stopRef.current = false;
    const total = Math.min(batch, maxBatch);
    setProgress({ done: 0, total });
    for (let i = 0; i < total; i++) {
      if (stopRef.current) break;
      const useSeed = seed >= 0 ? seed + i : -1;
      try {
        const images = await generateImages(
          info.advanced
            ? { prompt: prompt.trim(), negativePrompt: negative.trim(), width: w, height: h, steps, cfgScale: cfg, seed: useSeed }
            : { prompt: prompt.trim(), width: w, height: h },
          provider,
        );
        const sizes = await Promise.all(images.map(({ dataUrl }) => naturalSize(dataUrl, { w, h })));
        const items = images.map(({ dataUrl, mime, svg }, index) => ({
          id: uid('gen'),
          dataUrl,
          mime,
          svg,
          provider,
          prompt: prompt.trim(),
          negative: info.advanced ? negative.trim() : '',
          width: sizes[index].w,
          height: sizes[index].h,
          steps,
          cfg,
          seed: info.advanced && useSeed >= 0 ? useSeed : null,
          createdAt: Date.now(),
        }));
        setGallery((g) => [...items, ...g].slice(0, 60));
      } catch (e) {
        toast.error(t('Image generation failed'), e instanceof Error ? e.message : String(e));
        break;
      }
      setProgress({ done: i + 1, total });
    }
    setProgress(null);
  };

  const improve = async () => {
    if (!prompt.trim() || improving) return;
    const ctrl = new AbortController();
    improveAbort.current = ctrl;
    setImproving(true);
    try {
      const r = await runAI({ system: info.advanced ? IMPROVE_SD : IMPROVE_NATURAL, prompt: `Idea: ${prompt.trim()}`, signal: ctrl.signal });
      const better = r.text.replace(/^["'`\s]+|["'`\s]+$/g, '').replace(/^prompt:\s*/i, '').trim();
      if (better) {
        setPreviousPrompt(prompt);
        setPrompt(better.slice(0, 2000));
      }
    } catch (e) {
      if (!ctrl.signal.aborted) toast.error(t('Could not improve the prompt'), describeAIError(e));
    } finally {
      setImproving(false);
      improveAbort.current = null;
    }
  };

  const save = async (img: GeneratedImage, index: number) => {
    const slug = img.prompt.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40).replace(/-+$/, '') || 'image';
    const ext = EXTENSIONS[img.mime] ?? 'png';
    await saveFile(dataUrlToBlob(img.dataUrl), { suggestedName: `ultima-${slug}-${index + 1}.${ext}`, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
  };

  const providerPicker = (
    <Field label={t('Generator')}>
      <Select<ImageProviderId> small value={provider} onChange={(v) => update({ imageProvider: v })} options={IMAGE_PROVIDERS.map((p) => ({ value: p.id, label: t(p.name) }))} />
    </Field>
  );

  if (status !== 'ok') {
    return (
      <div className="as-images">
        <div className="as-images-setup card">
          <div className="row" style={{ gap: 10 }}>
            <ImageIcon size={22} color="var(--accent)" />
            <h2>{t('Generate images')}</h2>
          </div>
          {status === 'browser' ? (
            <>
              <div style={{ maxWidth: 320 }}>{providerPicker}</div>
              <p className="muted">
                {t('This generator runs through the Ultima desktop app (local Stable Diffusion, ComfyUI or LocalAI, or the Codex and Antigravity CLIs with your plan). In the browser, choose “SVG drawing by your AI”, which works with a local AI such as Ollama — or download the desktop app.')}
              </p>
            </>
          ) : (
            <>
              <div style={{ maxWidth: 320 }}>{providerPicker}</div>
              <p className="muted" style={{ margin: 0 }}>
                {t(info.note)}
              </p>
              {status === 'checking' && (
                <div className="row muted">
                  <Spinner size={14} /> {t('Checking {name}…', { name: t(info.name) })}
                </div>
              )}
              {status === 'unreachable' && (
                <>
                  <p className="muted">{t('{name} is not ready yet.', { name: t(info.name) })}</p>
                  {error && <pre className="code-block as-images-error">{error}</pre>}
                  <SetupSteps provider={provider} address={address} t={t} />
                </>
              )}
            </>
          )}
          <div className="row">
            {isDesktop && (
              <Button variant="primary" icon={RefreshCw} onClick={() => void check()} disabled={status === 'checking'}>
                {t('Check again')}
              </Button>
            )}
            <Button icon={Settings2} onClick={() => useAppStore.getState().setActiveModule('settings')}>
              {t('Open Settings')}
            </Button>
            {!isDesktop && (
              <Button icon={Download} onClick={() => openExternal('https://github.com/tenmaryut/ultima/releases/latest')}>
                {t('Download desktop app')}
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="as-images as-images-ready">
      <aside className="as-images-form">
        {providerPicker}
        <div className="row faint" style={{ fontSize: 11.5 }}>
          <span className="as-dot ok" />{' '}
          {provider === 'codex'
            ? t('Codex is ready · uses your ChatGPT plan')
            : provider === 'antigravity'
              ? t('Antigravity is ready · uses your Google AI plan')
              : provider === 'svg'
                ? t('Drawn by your AI · within your plan’s normal limits')
                : t('Connected to {url}', { url: address })}
          {provider === 'sd-webui' && models.length > 0 && <span title={models.join('\n')}>· {t('{count} models', { count: models.length })}</span>}
        </div>
        {provider === 'svg' && (
          <Field label={t('AI that draws')}>
            <DefaultableProviderPicker value={svgProvider} onChange={(id) => update({ svgProvider: id })} />
          </Field>
        )}
        {(provider === 'comfyui' || provider === 'local-openai') && (
          <Field label={t('Model')}>
            <Select
              small
              value={model}
              onChange={setModel}
              options={[
                { value: '', label: provider === 'comfyui' ? t('First checkpoint') : t('Choose a model'), disabled: provider === 'local-openai' },
                ...(model && !models.includes(model) ? [model] : []).concat(models).map((m) => ({ value: m, label: m })),
              ]}
            />
          </Field>
        )}
        <Field label={t('Prompt')}>
          <TextArea rows={5} value={prompt} placeholder={t('Describe the image: subject, style, lighting…')} onChange={(e) => setPrompt(e.target.value)} />
        </Field>
        <div className="row" style={{ gap: 6 }}>
          <Button size="sm" icon={improving ? undefined : Wand2} disabled={!prompt.trim() || improving} onClick={() => void improve()}>
            {improving && <Spinner size={12} />}
            {t('Improve prompt')}
          </Button>
          {improving && <IconButton icon={Square} size="sm" label={t('Stop')} onClick={() => improveAbort.current?.abort()} />}
          {previousPrompt !== null && !improving && (
            <Button
              size="sm"
              variant="ghost"
              icon={Undo2}
              onClick={() => {
                setPrompt(previousPrompt);
                setPreviousPrompt(null);
              }}
            >
              {t('Undo')}
            </Button>
          )}
        </div>
        {info.advanced && (
          <Field label={t('Negative prompt')}>
            <TextArea rows={2} value={negative} onChange={(e) => setNegative(e.target.value)} />
          </Field>
        )}
        <Field label={t('Size')}>
          <Select small value={chosenSize} onChange={setSize} options={sizeOptions.map((s) => ({ value: s.value, label: s.value === 'custom' ? t('Custom') : t(s.label) }))} />
        </Field>
        {chosenSize === 'custom' && (
          <div className="row">
            <NumberField small value={custom.w} min={64} max={2048} step={8} suffix="px" onChange={(v) => setCustom({ ...custom, w: Math.round(v / 8) * 8 })} />
            <span className="faint">×</span>
            <NumberField small value={custom.h} min={64} max={2048} step={8} suffix="px" onChange={(v) => setCustom({ ...custom, h: Math.round(v / 8) * 8 })} />
          </div>
        )}
        {info.advanced && (
          <>
            <Slider label={t('Steps')} value={steps} min={1} max={100} onChange={(v) => setSteps(Math.round(v))} defaultValue={25} />
            <Slider label={t('Guidance (CFG)')} value={cfg} min={1} max={20} step={0.5} onChange={setCfg} defaultValue={7} />
          </>
        )}
        <div className="row">
          {info.advanced && (
            <Field label={t('Seed (−1 = random)')}>
              <NumberField small value={seed} min={-1} max={2 ** 32 - 1} onChange={(v) => setSeed(Math.round(v))} />
            </Field>
          )}
          <Field label={t('Batch')}>
            <NumberField small value={Math.min(batch, maxBatch)} min={1} max={maxBatch} onChange={(v) => setBatch(Math.round(v))} />
          </Field>
        </div>
        {provider === 'codex' && <span className="faint" style={{ fontSize: 11.5 }}>{t('Each image uses your ChatGPT plan’s allowance and takes about a minute.')}</span>}
        {provider === 'antigravity' && <span className="faint" style={{ fontSize: 11.5 }}>{t('Each image uses your Google AI plan’s quota and takes about a minute.')}</span>}
        {provider === 'svg' && <span className="faint" style={{ fontSize: 11.5 }}>{t('Good for illustrations, icons and flat art. Open the result in Vector to edit it.')}</span>}
        {progress ? (
          <Button variant="default" icon={Square} block onClick={() => (stopRef.current = true)}>
            {t('Stop after this image ({done}/{total})', { done: progress.done, total: progress.total })}
          </Button>
        ) : (
          <Button variant="primary" icon={Sparkles} block disabled={!prompt.trim() || needsModel} onClick={() => void generate()}>
            {t('Generate')}
          </Button>
        )}
      </aside>
      <div className="as-gallery">
        {progress && (
          <div className="as-gallery-progress muted">
            <Spinner size={16} /> {t('Generating {done}/{total}… (this can take a while on the first run)', { done: progress.done + 1, total: progress.total })}
          </div>
        )}
        {!gallery.length && !progress && <div className="as-gallery-empty faint">{t('Generated images appear here. They are kept until you close Ultima — save the ones you like.')}</div>}
        <div className="as-gallery-grid">
          {gallery.map((img, i) => {
            const advanced = imageProviderInfo(img.provider).advanced;
            return (
              <figure key={img.id} className="as-gallery-item">
                <img src={img.dataUrl} alt={img.prompt} style={{ aspectRatio: `${img.width} / ${img.height}` }} />
                <figcaption>
                  <span className="as-gallery-prompt" title={img.prompt}>
                    {img.prompt}
                  </span>
                  <span className="faint">
                    {img.width}×{img.height} · {advanced ? `${img.steps} ${t('steps')} · CFG ${img.cfg}` : t(imageProviderInfo(img.provider).name)}
                    {img.seed !== null ? ` · ${t('seed')} ${img.seed}` : ''}
                  </span>
                  <span className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                    <Button size="sm" icon={Download} onClick={() => void save(img, i)}>
                      {(EXTENSIONS[img.mime] ?? 'png').toUpperCase()}
                    </Button>
                    <Button size="sm" icon={ImageIcon} onClick={() => useAppStore.getState().sendToModule('photo', { kind: 'image', image: img.dataUrl, title: img.prompt.slice(0, 60) })}>
                      {t('Open in Photo')}
                    </Button>
                    {img.svg && (
                      <Button size="sm" icon={PenTool} onClick={() => useAppStore.getState().sendToModule('vector', { kind: 'svg', svg: img.svg, title: img.prompt.slice(0, 60) })}>
                        {t('Open in Vector')}
                      </Button>
                    )}
                    <IconButton
                      icon={Wand2}
                      size="sm"
                      label={t('Reuse these settings')}
                      onClick={() => {
                        setPrompt(img.prompt);
                        if (advanced) {
                          setNegative(img.negative);
                          setSteps(img.steps);
                          setCfg(img.cfg);
                          if (img.seed !== null) setSeed(img.seed);
                        }
                      }}
                    />
                    <IconButton icon={Sparkles} size="sm" label={t('Copy prompt')} onClick={() => void copyToClipboard(img.prompt, t('Prompt copied'))} />
                    <IconButton icon={Trash2} size="sm" label={t('Remove')} onClick={() => setGallery((g) => g.filter((x) => x.id !== img.id))} />
                  </span>
                </figcaption>
              </figure>
            );
          })}
        </div>
      </div>
    </div>
  );
}
