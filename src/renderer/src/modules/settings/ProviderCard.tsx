import { useState } from 'react';
import { ChevronDown, ChevronRight, Copy, ExternalLink, FlaskConical, FolderCog, ShieldCheck } from 'lucide-react';
import type { OsKey, ProviderInfo, ProviderStatus } from '@shared/ai-types';
import { PROVIDER_TERMS } from '@shared/providers-catalog';
import { useAISettings } from '../../core/ai/settings';
import { describeAIError, detectProviders, runAI } from '../../core/ai/client';
import { desktop, isMac, openExternal } from '../../core/platform';
import { useT } from '../../core/i18n';
import { Badge, Button, Modal, Select, Spinner, TextInput, Toggle, toast, promptDialog } from '../../components/ui';

export function currentOs(): OsKey {
  const p = (desktop?.platform ?? navigator.platform).toLowerCase();
  if (p.includes('win')) return 'windows';
  if (isMac || p.includes('darwin')) return 'mac';
  return 'linux';
}

export function CopyCommand({ command, note }: { command: string; note?: string }) {
  const t = useT();
  return (
    <div className="row" style={{ gap: 6 }}>
      <code className="code-block grow" style={{ padding: '5px 8px' }}>
        {command}
      </code>
      <button
        type="button"
        className="icon-btn sm"
        title={t('Copy')}
        onClick={() => {
          void navigator.clipboard.writeText(command);
          toast.success(t('Copied to clipboard'));
        }}
      >
        <Copy size={13} />
      </button>
      {note && <span className="faint" style={{ fontSize: 11, maxWidth: 160 }}>{note}</span>}
    </div>
  );
}

export function ProviderCard({ info, status }: { info: ProviderInfo; status?: ProviderStatus }) {
  const t = useT();
  const enabled = useAISettings((s) => Boolean(s.enabled[info.id]));
  const model = useAISettings((s) => s.models[info.id] ?? '');
  const setEnabled = useAISettings((s) => s.setEnabled);
  const setModel = useAISettings((s) => s.setModel);
  const ollamaUrl = useAISettings((s) => s.ollamaUrl);
  const compatUrl = useAISettings((s) => s.openaiCompatUrl);
  const compatKey = useAISettings((s) => s.openaiCompatKey);
  const update = useAISettings((s) => s.update);
  const [open, setOpen] = useState(!status?.available);
  const [terms, setTerms] = useState(false);
  const [testing, setTesting] = useState(false);
  const os = currentOs();
  const needsDesktop = info.kind === 'cli' && !desktop;

  const modelOptions = [
    ...info.models,
    ...(status?.models ?? []).filter((m) => !info.models.some((o) => o.id === m)).map((m) => ({ id: m, label: m })),
  ];
  if (model && !modelOptions.some((m) => m.id === model)) modelOptions.push({ id: model, label: model });

  const test = async () => {
    setTesting(true);
    try {
      const res = await runAI({
        providerId: info.id,
        system: 'You are a connection test. Answer with one short sentence.',
        prompt: 'Say hello and tell me which model you are, in at most 12 words.',
      });
      toast.success(`${info.name}: ${t('connected')}`, `${res.text.trim().slice(0, 200)}\n(${(res.durationMs / 1000).toFixed(1)}s)`);
    } catch (error) {
      toast.error(`${info.name}: ${t('test failed')}`, describeAIError(error));
    } finally {
      setTesting(false);
    }
  };

  const statusBadge = needsDesktop ? (
    <Badge tone="warn">{t('Desktop app only')}</Badge>
  ) : status?.available ? (
    <Badge tone="ok">
      {info.kind === 'cli' ? t('Installed') : t('Running')}
      {status.version ? ` · ${status.version.slice(0, 40)}` : ''}
    </Badge>
  ) : status ? (
    <Badge tone="err">{info.kind === 'cli' ? t('Not found') : t('Not running')}</Badge>
  ) : (
    <Badge>{t('Unknown')}</Badge>
  );

  return (
    <div className="provider-row">
      <div className="col" style={{ gap: 6, minWidth: 0 }}>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <strong style={{ color: 'var(--text-0)', fontSize: 14 }}>{info.name}</strong>
          <span className="faint">{info.vendor}</span>
          {statusBadge}
          {info.free && <Badge tone="ok">{t('Free')}</Badge>}
          {info.supportsImages && <Badge>{t('Understands images')}</Badge>}
        </div>
        <span className="muted" style={{ fontSize: 12 }}>
          {t('Needs:')} {t(info.plan)}
        </span>

        {info.kind === 'http' && (
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <TextInput
              small
              style={{ maxWidth: 260 }}
              value={info.id === 'ollama' ? ollamaUrl : compatUrl}
              onChange={(e) => update(info.id === 'ollama' ? { ollamaUrl: e.target.value } : { openaiCompatUrl: e.target.value })}
              onBlur={() => void detectProviders(true)}
              aria-label={t('Server URL')}
            />
            {info.id === 'openai-compatible' && (
              <TextInput
                small
                type="password"
                style={{ maxWidth: 180 }}
                placeholder={t('Key (optional)')}
                value={compatKey}
                onChange={(e) => update({ openaiCompatKey: e.target.value })}
              />
            )}
          </div>
        )}

        {status?.error && !status.available && info.kind === 'http' && (
          <span className="faint" style={{ fontSize: 11 }}>{status.error.slice(0, 200)}</span>
        )}

        <button
          type="button"
          className="row faint"
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12 }}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {t('How to install and sign in')}
        </button>
        {open && (
          <div className="col" style={{ gap: 6, paddingLeft: 4 }}>
            {info.installCommands
              .filter((c) => c.os === 'all' || c.os === os)
              .map((c) => (
                <CopyCommand key={c.command} command={c.command} note={c.note} />
              ))}
            <ol style={{ margin: '4px 0', paddingLeft: 18 }} className="muted">
              {info.loginSteps.map((s) => (
                <li key={s}>{t(s)}</li>
              ))}
            </ol>
            <div className="row">
              <Button size="sm" variant="ghost" icon={ExternalLink} onClick={() => openExternal(info.docsUrl)}>
                {t('Official docs')}
              </Button>
              {info.kind === 'cli' && desktop && info.id !== 'custom' && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={FolderCog}
                  onClick={async () => {
                    const path = await promptDialog({
                      title: t('Custom location for {name}', { name: info.name }),
                      message: t('Full path to the program (leave empty to search PATH).'),
                      defaultValue: status?.location ?? '',
                    });
                    if (path === null) return;
                    const ok = await desktop!.ai.setExecutablePath(info.id, path.trim() || null);
                    if (ok) void detectProviders(true);
                  }}
                >
                  {t('Set program path')}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="col" style={{ alignItems: 'flex-end', gap: 8 }}>
        <Toggle
          checked={enabled}
          disabled={needsDesktop}
          label={enabled ? t('Enabled') : t('Disabled')}
          onChange={(v) => {
            if (v && info.kind === 'cli') setTerms(true);
            else setEnabled(info.id, v);
          }}
        />
        <Select
          small
          value={model}
          style={{ width: 200 }}
          options={modelOptions.map((m) => ({ value: m.id, label: t(m.label) }))}
          onChange={(v) => setModel(info.id, v)}
        />
        {info.id !== 'custom' && info.kind === 'cli' && (
          <TextInput
            small
            style={{ width: 200 }}
            placeholder={t('or type a model name')}
            defaultValue={info.models.some((m) => m.id === model) ? '' : model}
            onBlur={(e) => e.target.value.trim() && setModel(info.id, e.target.value.trim())}
          />
        )}
        <Button size="sm" icon={FlaskConical} disabled={!enabled || !status?.available || testing} onClick={test}>
          {testing ? <Spinner size={12} /> : null}
          {t('Test')}
        </Button>
      </div>

      {terms && (
        <TermsModal
          info={info}
          onCancel={() => setTerms(false)}
          onAccept={() => {
            setEnabled(info.id, true);
            setTerms(false);
          }}
        />
      )}
    </div>
  );
}

function TermsModal({ info, onAccept, onCancel }: { info: ProviderInfo; onAccept: () => void; onCancel: () => void }) {
  const t = useT();
  const [ack, setAck] = useState(false);
  const terms = PROVIDER_TERMS[info.id];
  return (
    <Modal
      title={t('Enable {name}?', { name: info.name })}
      onClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel}>{t('Cancel')}</Button>
          <Button variant="primary" icon={ShieldCheck} disabled={!ack} onClick={onAccept}>
            {t('Enable')}
          </Button>
        </>
      }
    >
      <p style={{ margin: 0 }}>
        {t('Ultima will start the {command} program installed on this computer — the same way you would in a terminal — and send it your requests.', {
          command: info.command ?? info.name,
        })}
      </p>
      <ul className="muted" style={{ margin: 0, paddingLeft: 18 }}>
        <li>{t('Requests use your own plan ({plan}) and count against its usage limits.', { plan: t(info.plan) })}</li>
        <li>{t('Ultima never reads, stores or sends your login details. API-key variables are removed so you are not billed per token.')}</li>
        <li>{t('You are responsible for using {vendor} services according to their terms.', { vendor: info.vendor })}</li>
      </ul>
      {info.termsNote && (
        <div className="card" style={{ borderColor: 'color-mix(in srgb, var(--warning) 50%, transparent)', padding: 10 }}>
          <strong style={{ color: 'var(--warning)' }}>{t('Please note')}</strong>
          <div className="muted" style={{ marginTop: 4 }}>{t(info.termsNote)}</div>
        </div>
      )}
      {terms && (
        <Button size="sm" variant="ghost" icon={ExternalLink} onClick={() => openExternal(terms.url)}>
          {terms.label}
        </Button>
      )}
      <Toggle checked={ack} onChange={setAck} label={t('I understand and want to enable it')} />
    </Modal>
  );
}
