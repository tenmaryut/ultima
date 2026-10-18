import { useEffect, useState } from 'react';
import { Check, Info, RefreshCw, Save, Wrench } from 'lucide-react';
import type { ModuleProps } from '../../core/modules';
import { PROVIDERS } from '@shared/providers-catalog';
import type { AppInfo, MainAIConfig } from '@shared/ipc';
import { useAppStore, type ThemeSetting } from '../../core/store';
import { GRADIENTS, gradientCss } from '../../core/themes';
import { LANGUAGES, useT, type Language } from '../../core/i18n';
import { MAX_TIMEOUT_MINUTES, useAISettings } from '../../core/ai/settings';
import { detectProviders } from '../../core/ai/client';
import { desktop, openExternal } from '../../core/platform';
import { Badge, Button, Field, NumberField, Select, Spinner, TextInput, Toggle, promptDialog, toast } from '../../components/ui';
import { ProviderCard } from './ProviderCard';
import { ImageGenerationSettings, SpeechSettings } from './MediaSettings';
import { ExportFolderSettings, useExportFolder } from '../../components/ExportFolder';

const REPO = 'https://github.com/tenmaryut/ultima';

export default function SettingsModule({ active }: ModuleProps) {
  const t = useT();
  const theme = useAppStore((s) => s.theme);
  const language = useAppStore((s) => s.language);
  const setTheme = useAppStore((s) => s.setTheme);
  const setLanguage = useAppStore((s) => s.setLanguage);
  const gradient = useAppStore((s) => s.gradient);
  const setGradient = useAppStore((s) => s.setGradient);
  const accentMode = useAppStore((s) => s.accentMode);
  const setAccentMode = useAppStore((s) => s.setAccentMode);
  const ai = useAISettings();
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    if (!active) return;
    void detectProviders(true).catch(() => undefined);
    void desktop?.app.getInfo().then(setAppInfo);
  }, [active]);

  const usable = PROVIDERS.filter((p) => ai.enabled[p.id] && ai.statuses.find((s) => s.id === p.id)?.available);

  return (
    <div className="settings">
      <div className="settings-inner">
        <h1 style={{ margin: 0, color: 'var(--text-0)', fontSize: 22 }}>{t('Settings')}</h1>

        <section className="card col" style={{ gap: 12 }}>
          <h2 className="section-title">{t('General')}</h2>
          <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
            <Field label={t('Language')}>
              <Select<Language> value={language} onChange={setLanguage} options={LANGUAGES.map((l) => ({ value: l.id, label: l.label }))} />
            </Field>
            <Field label={t('Theme')}>
              <Select<ThemeSetting>
                value={theme}
                onChange={setTheme}
                options={[
                  { value: 'dark', label: t('Dark') },
                  { value: 'light', label: t('Light') },
                  { value: 'system', label: t('Follow system') },
                ]}
              />
            </Field>
          </div>
          <div className="col" style={{ gap: 6 }}>
            <span className="field-label" id="settings-gradient">
              {t('Color gradient')}
            </span>
            <div className="gradient-picker" role="radiogroup" aria-labelledby="settings-gradient">
              {GRADIENTS.map((g) => (
                <button key={g.id} type="button" role="radio" aria-checked={gradient === g.id} className="gradient-swatch" onClick={() => setGradient(g.id)}>
                  <span className="preview" style={{ background: gradientCss(g) }} />
                  <span className="name">
                    {gradient === g.id && <Check size={13} />}
                    {t(g.name)}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <Toggle
            checked={accentMode === 'gradient'}
            onChange={(v) => setAccentMode(v ? 'gradient' : 'tools')}
            label={t('Use the gradient’s color in every tool too (otherwise each tool keeps its own color)')}
          />
        </section>

        <section className="card col" style={{ gap: 12 }}>
          <div className="row">
            <h2 className="section-title grow" style={{ margin: 0 }}>
              {t('AI connections')}
            </h2>
            <Button size="sm" icon={RefreshCw} disabled={ai.detecting} onClick={() => void detectProviders(true)}>
              {ai.detecting ? <Spinner size={12} /> : null}
              {t('Check again')}
            </Button>
          </div>
          <div className="row muted" style={{ alignItems: 'flex-start', gap: 8 }}>
            <Info size={16} style={{ flex: '0 0 auto', marginTop: 2 }} />
            <span>
              {t('Ultima never uses paid, per-token API keys. It talks to AI tools that are installed on this computer and signed in with your own subscription, or to free models running locally. Your login details never pass through Ultima.')}
            </span>
          </div>
          {!desktop && (
            <div className="card" style={{ borderColor: 'color-mix(in srgb, var(--warning) 45%, transparent)', padding: 10 }}>
              {t('You are using the browser version. Subscription tools (Claude Code, Codex, Antigravity CLI, Copilot…) need the desktop app. Local servers like Ollama work here too — start Ollama with OLLAMA_ORIGINS set to this page’s address.')}
            </div>
          )}
          <Field label={t('Default AI')}>
            <Select
              value={ai.defaultProvider ?? ''}
              onChange={(v) => ai.update({ defaultProvider: (v || null) as never })}
              options={[
                { value: '', label: t('Automatic (first available)') },
                ...usable.map((p) => ({ value: p.id, label: p.name })),
              ]}
              style={{ maxWidth: 320 }}
            />
          </Field>
          <div className="col" style={{ gap: 10 }}>
            {PROVIDERS.filter((p) => p.id !== 'custom').map((p) => (
              <ProviderCard key={p.id} info={p} status={ai.statuses.find((s) => s.id === p.id)} />
            ))}
          </div>
          {desktop && <CustomCommand />}
        </section>

        <section className="card col" style={{ gap: 12 }}>
          <h2 className="section-title">{t('AI behaviour')}</h2>
          <Toggle checked={ai.autoApply} onChange={(v) => ai.update({ autoApply: v })} label={t('Apply AI edits automatically (otherwise you review them first)')} />
          <Toggle checked={ai.sendSnapshots} onChange={(v) => ai.update({ sendSnapshots: v })} label={t('Send a snapshot of the canvas to AIs that understand images')} />
          {desktop && (
            <Toggle
              checked={ai.blockApiBilling}
              onChange={(v) => ai.update({ blockApiBilling: v })}
              label={t('Never bill an API key (remove ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY… before starting AI tools)')}
            />
          )}
          <Field label={t('Time limit per request')} inline>
            <NumberField
              value={Math.max(1, Math.round(ai.timeoutSec / 60))}
              min={1}
              max={MAX_TIMEOUT_MINUTES}
              step={5}
              suffix={t('min')}
              style={{ width: 110 }}
              onChange={(v) => ai.update({ timeoutSec: Math.round(v * 60) })}
            />
          </Field>
          <div className="muted" style={{ fontSize: 12 }}>
            {t('Agent AIs such as Claude Code, Codex or Antigravity can work on a big edit for an hour or more. Up to 24 hours; Stop ends a request at any time.')}
          </div>
        </section>

        <ExportSettings />

        <ImageGenerationSettings />

        <SpeechSettings />

        <LocalTools />

        <section className="card col" style={{ gap: 8 }}>
          <h2 className="section-title">{t('About')}</h2>
          <div>
            <strong style={{ color: 'var(--text-0)' }}>Ultima</strong> {appInfo ? `v${appInfo.version}` : t('web version')}
            {appInfo && (
              <span className="faint">
                {' '}
                · Electron {appInfo.electron} · {appInfo.platform}/{appInfo.arch}
              </span>
            )}
          </div>
          <div className="muted">
            {t('Free and open source under the MIT license. Not affiliated with Adobe, Anthropic, OpenAI, Google, GitHub or any other company mentioned.')}
          </div>
          <div className="row">
            <Button size="sm" onClick={() => openExternal(REPO)}>
              GitHub
            </Button>
            <Button size="sm" onClick={() => openExternal(`${REPO}/blob/main/docs/USER_GUIDE.md`)}>
              {t('User guide')}
            </Button>
            <Button size="sm" onClick={() => openExternal(`${REPO}/issues/new`)}>
              {t('Report a problem')}
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}

function CustomCommand() {
  const t = useT();
  const [config, setConfig] = useState<MainAIConfig | null>(null);
  const [name, setName] = useState('');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [plain, setPlain] = useState(true);
  const status = useAISettings((s) => s.statuses.find((x) => x.id === 'custom'));
  const enabled = useAISettings((s) => Boolean(s.enabled.custom));
  const setEnabled = useAISettings((s) => s.setEnabled);

  useEffect(() => {
    void desktop?.ai.getConfig().then((c) => {
      setConfig(c);
      if (c.custom) {
        setName(c.custom.name);
        setCommand(c.custom.command);
        setArgs(c.custom.args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' '));
        setPlain(c.custom.plainText);
      }
    });
  }, []);

  const save = async () => {
    const parsedArgs = (args.match(/"[^"]*"|\S+/g) ?? []).map((a) => (a.startsWith('"') ? a.slice(1, -1) : a));
    const ok = await desktop!.ai.setCustomCli(command.trim() ? { name: name.trim() || command.trim(), command: command.trim(), args: parsedArgs, plainText: plain } : null);
    if (ok) {
      toast.success(t('Custom command saved'));
      void detectProviders(true);
    }
  };

  return (
    <div className="provider-row">
      <div className="col" style={{ gap: 8 }}>
        <div className="row">
          <Wrench size={15} />
          <strong style={{ color: 'var(--text-0)' }}>{t('Custom command')}</strong>
          {status?.available ? <Badge tone="ok">{t('Ready')}</Badge> : config?.custom ? <Badge tone="err">{t('Not found')}</Badge> : null}
        </div>
        <span className="muted" style={{ fontSize: 12 }}>
          {t('Use any other AI command-line tool. Ultima sends the prompt on standard input and reads the answer from standard output.')}
        </span>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <TextInput small style={{ width: 150 }} placeholder={t('Name')} value={name} onChange={(e) => setName(e.target.value)} />
          <TextInput small style={{ width: 170 }} placeholder={t('Program, e.g. aider')} value={command} onChange={(e) => setCommand(e.target.value)} />
          <TextInput small style={{ width: 260 }} placeholder={t('Arguments, e.g. --no-stream')} value={args} onChange={(e) => setArgs(e.target.value)} />
        </div>
        <Toggle checked={plain} onChange={setPlain} label={t('Output is plain text')} />
      </div>
      <div className="col" style={{ alignItems: 'flex-end', gap: 8 }}>
        <Toggle checked={enabled} onChange={(v) => setEnabled('custom', v)} label={enabled ? t('Enabled') : t('Disabled')} />
        <Button size="sm" icon={Save} onClick={save}>
          {t('Save')}
        </Button>
      </div>
    </div>
  );
}

function LocalTools() {
  const t = useT();
  const tools = useAISettings((s) => s.tools);

  const toolInfo: Record<string, { label: string; what: string; install: string }> = {
    whisper: {
      label: 'Whisper (speech to text)',
      what: 'Automatic captions in Video and transcripts in Audio.',
      install: 'pip install -U openai-whisper   — or install whisper.cpp (whisper-cli)',
    },
    rembg: {
      label: 'rembg (background removal)',
      what: 'One-click background removal in Photo, and cutting the subject out of clips in Video.',
      install: 'pip install "rembg[cpu,cli]"',
    },
    demucs: {
      label: 'Demucs (stem separation)',
      what: 'Splits songs into vocals, drums, bass and the rest in Video, better than the built-in separation.',
      install: 'pip install demucs',
    },
    ffmpeg: {
      label: 'FFmpeg',
      what: 'Extra import/export formats for video and audio.',
      install: 'brew install ffmpeg  /  winget install ffmpeg  /  sudo apt install ffmpeg',
    },
  };

  return (
    <section className="card col" style={{ gap: 12 }}>
      <h2 className="section-title">{t('Local creative tools (optional, free)')}</h2>
      <div className="muted">{t('These free tools run on your own computer and unlock extra AI features. Ultima finds them automatically.')}</div>
      {!desktop && <div className="muted">{t('These tools need the Ultima desktop app.')}</div>}
      {desktop &&
        (['whisper', 'rembg', 'demucs', 'ffmpeg'] as const).map((id) => {
          const st = tools.find((x) => x.id === id);
          const info = toolInfo[id];
          return (
            <div key={id} className="provider-row">
              <div className="col" style={{ gap: 4 }}>
                <div className="row">
                  <strong style={{ color: 'var(--text-0)' }}>{t(info.label)}</strong>
                  {st?.available ? <Badge tone="ok">{t('Found')}</Badge> : <Badge>{t('Not installed')}</Badge>}
                </div>
                <span className="muted" style={{ fontSize: 12 }}>{t(info.what)}</span>
                {!st?.available && <code className="code-block" style={{ padding: '4px 8px' }}>{info.install}</code>}
                {st?.location && <span className="faint mono" style={{ fontSize: 11 }}>{st.location}</span>}
              </div>
              <div className="col" style={{ alignItems: 'flex-end' }}>
                {id !== 'ffmpeg' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      const cmd = await promptDialog({ title: t(info.label), message: t('Program name or full path'), defaultValue: st?.location ?? '' });
                      if (cmd === null) return;
                      const ok = await desktop!.tools.setCommand(id, cmd.trim() || null);
                      if (ok) void detectProviders(true);
                    }}
                  >
                    {t('Set path')}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
    </section>
  );
}

function ExportSettings() {
  const t = useT();
  const [info, setInfo] = useExportFolder();
  if (!desktop) return null;
  return (
    <section className="card col" style={{ gap: 12 }}>
      <h2 className="section-title">{t('Exports')}</h2>
      <ExportFolderSettings info={info} onChange={setInfo} />
    </section>
  );
}
