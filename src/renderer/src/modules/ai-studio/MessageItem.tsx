import { useMemo, useState } from 'react';
import { Clapperboard, Code, Copy, Download, FileText, LayoutTemplate, Orbit, Palette, PenTool, Pencil, RefreshCw, Send, Share2, TriangleAlert, X } from 'lucide-react';
import type { ProviderId } from '@shared/ai-types';
import { getProviderInfo } from '@shared/providers-catalog';
import { Markdown } from '../../components/ai/Markdown';
import { Button, DropdownButton, IconButton, Spinner, toast, type MenuEntry } from '../../components/ui';
import { sanitizeSvg } from '../../core/ai/sanitize';
import { saveFile } from '../../core/platform';
import { useAppStore } from '../../core/store';
import { t as translate, useT } from '../../core/i18n';
import { detectHexColors, detectSvg, markdownToPlain } from './detect';
import type { ChatMessage } from './types';

export function providerName(id: ProviderId | undefined | null): string {
  return (id && getProviderInfo(id)?.name) || 'AI';
}

export async function copyToClipboard(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(label);
  } catch {
    toast.error(translate('Could not copy to the clipboard'));
  }
}

interface Props {
  message: ChatMessage;
  title: string;
  canEdit: boolean;
  canRegenerate: boolean;
  onRegenerate: () => void;
  onEditResend: (text: string) => void;
}

export function MessageItem({ message, title, canEdit, canRegenerate, onRegenerate, onEditResend }: Props) {
  const t = useT();
  const [editing, setEditing] = useState<string | null>(null);
  const sendTo = useAppStore((s) => s.sendToModule);

  const svg = useMemo(() => {
    if (message.role !== 'assistant' || message.status === 'streaming') return null;
    const raw = detectSvg(message.text);
    if (!raw) return null;
    try {
      const clean = sanitizeSvg(raw);
      return clean ? clean : null;
    } catch {
      return null;
    }
  }, [message.role, message.status, message.text]);
  const colors = useMemo(
    () => (message.role === 'assistant' && message.status !== 'streaming' ? detectHexColors(message.text, 12) : []),
    [message.role, message.status, message.text],
  );

  if (message.role === 'user') {
    if (editing !== null) {
      return (
        <div className="as-msg as-user as-editing">
          <textarea
            className="textarea"
            value={editing}
            autoFocus
            rows={Math.min(10, Math.max(2, editing.split('\n').length))}
            onChange={(e) => setEditing(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (editing.trim()) {
                  onEditResend(editing);
                  setEditing(null);
                }
              }
              if (e.key === 'Escape') setEditing(null);
            }}
            aria-label={t('Edit message')}
          />
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <Button size="sm" variant="ghost" icon={X} onClick={() => setEditing(null)}>
              {t('Cancel')}
            </Button>
            <Button
              size="sm"
              variant="primary"
              icon={Send}
              disabled={!editing.trim()}
              onClick={() => {
                onEditResend(editing);
                setEditing(null);
              }}
            >
              {t('Save & resend')}
            </Button>
          </div>
        </div>
      );
    }
    return (
      <div className="as-msg as-user">
        {message.attachments?.length ? (
          <div className="as-attachments">
            {message.attachments.map((a) =>
              a.kind === 'image' && (a.thumb || a.dataUrl) ? (
                <img key={a.id} src={a.thumb ?? a.dataUrl} alt={a.name} title={a.name} className="as-att-thumb" />
              ) : (
                <span key={a.id} className="as-att-file" title={a.name}>
                  <FileText size={13} /> {a.name}
                </span>
              ),
            )}
          </div>
        ) : null}
        {message.text && <div className="as-user-text selectable">{message.text}</div>}
        <div className="as-msg-actions">
          <IconButton icon={Copy} size="sm" label={t('Copy')} onClick={() => void copyToClipboard(message.text, t('Copied to clipboard'))} />
          {canEdit && <IconButton icon={Pencil} size="sm" label={t('Edit & resend')} onClick={() => setEditing(message.text)} />}
        </div>
      </div>
    );
  }

  const plain = () => markdownToPlain(message.text);
  const sendEntries: MenuEntry[] = [
    ...(svg ? [{ label: t('Vector Designer (SVG)'), icon: PenTool, onClick: () => sendTo('vector', { kind: 'svg', svg, title }) } as MenuEntry] : []),
    ...(colors.length ? [{ label: t('Color Studio ({count} colors)', { count: colors.length }), icon: Palette, onClick: () => sendTo('color', { kind: 'palette', palette: colors, title }) } as MenuEntry] : []),
    { label: t('Layout (text)'), icon: LayoutTemplate, onClick: () => sendTo('layout', { kind: 'text', text: plain(), title }) },
    { label: t('Motion (text)'), icon: Orbit, onClick: () => sendTo('motion', { kind: 'text', text: plain(), title }) },
    { label: t('Video (title)'), icon: Clapperboard, onClick: () => sendTo('video', { kind: 'text', text: plain(), title }) },
    { type: 'separator' },
    { label: t('Copy as Markdown'), icon: Copy, onClick: () => void copyToClipboard(message.text, t('Markdown copied')) },
  ];

  const meta = [providerName(message.providerId), message.model, message.durationMs ? `${(message.durationMs / 1000).toFixed(1)} s` : ''].filter(Boolean).join(' · ');

  return (
    <div className={`as-msg as-assistant ${message.status === 'error' ? 'as-error' : ''}`}>
      <div className="as-msg-meta faint">{meta}</div>
      {message.status === 'streaming' && !message.text ? (
        <div className="row muted">
          <Spinner size={14} /> {t('Thinking…')}
        </div>
      ) : message.text ? (
        <div className={`as-md selectable ${message.status === 'streaming' ? 'as-streaming' : ''}`}>
          <Markdown text={message.text} />
        </div>
      ) : null}
      {message.status === 'error' && (
        <div className="as-error-box selectable">
          <TriangleAlert size={14} />
          <span>{message.error || t('The AI request failed')}</span>
        </div>
      )}
      {message.status === 'stopped' && <span className="badge warn">{t('Stopped')}</span>}

      {svg && (
        <div className="as-svg-preview">
          <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} alt={t('SVG preview')} />
          <div className="col" style={{ gap: 6 }}>
            <Button size="sm" variant="primary" icon={PenTool} onClick={() => sendTo('vector', { kind: 'svg', svg, title })}>
              {t('Open in Vector')}
            </Button>
            <Button size="sm" icon={Download} onClick={() => void saveFile(new Blob([svg], { type: 'image/svg+xml' }), { suggestedName: 'ultima-ai.svg', filters: [{ name: 'SVG', extensions: ['svg'] }] })}>
              {t('Save SVG')}
            </Button>
          </div>
        </div>
      )}
      {colors.length >= 2 && (
        <div className="as-colors">
          {colors.map((c) => (
            <span key={c} className="as-color" style={{ background: c }} title={c.toUpperCase()} />
          ))}
          <Button size="sm" icon={Palette} onClick={() => sendTo('color', { kind: 'palette', palette: colors, title })}>
            {t('Open in Color Studio')}
          </Button>
        </div>
      )}

      {message.status !== 'streaming' && (
        <div className="as-msg-actions">
          <IconButton icon={Copy} size="sm" label={t('Copy')} disabled={!message.text} onClick={() => void copyToClipboard(plain(), t('Copied to clipboard'))} />
          <IconButton icon={Code} size="sm" label={t('Copy as Markdown')} disabled={!message.text} onClick={() => void copyToClipboard(message.text, t('Markdown copied'))} />
          {canRegenerate && <IconButton icon={RefreshCw} size="sm" label={message.status === 'error' ? t('Try again') : t('Regenerate')} onClick={onRegenerate} />}
          {message.text && (
            <DropdownButton className="btn sm ghost" entries={sendEntries} title={t('Send to another module')}>
              <Share2 size={12} /> {t('Send to…')}
            </DropdownButton>
          )}
        </div>
      )}
    </div>
  );
}
