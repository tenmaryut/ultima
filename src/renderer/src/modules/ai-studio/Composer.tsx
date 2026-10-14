import { useEffect, useRef } from 'react';
import { BookOpen, FileText, Paperclip, Send, Square, X } from 'lucide-react';
import { Button, IconButton, toast } from '../../components/ui';
import { pickFiles } from '../../core/platform';
import { useT } from '../../core/i18n';
import { ATTACH_ACCEPT, fileToAttachment, isAttachable } from './attachments';
import type { Attachment } from './types';

interface Props {
  value: string;
  onChange: (value: string) => void;
  attachments: Attachment[];
  onAttachments: (list: Attachment[]) => void;
  onSend: () => void;
  onStop: () => void;
  busy: boolean;
  disabled: boolean;
  imagesSupported: boolean;
  onOpenTemplates: () => void;
  placeholder?: string;
  focusKey?: unknown;
}

/** Message box: Enter sends, Shift+Enter adds a line, files can be attached, pasted or dropped. */
export function Composer(props: Props) {
  const t = useT();
  const ref = useRef<HTMLTextAreaElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    ref.current?.focus();
  }, [props.focusKey]);

  // grow with the text (up to ~12 lines)
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(260, Math.max(64, el.scrollHeight + 2))}px`;
  }, [props.value]);

  const addFiles = async (files: File[]) => {
    const list = [...propsRef.current.attachments];
    for (const file of files) {
      if (!isAttachable(file)) {
        toast.warning(t('Cannot attach {name}', { name: file.name }), t('Only images and text files (.txt, .md, .csv, .json, .srt…) can be attached'));
        continue;
      }
      try {
        list.push(await fileToAttachment(file));
      } catch (error) {
        toast.error(t('Cannot attach {name}', { name: file.name }), error instanceof Error ? error.message : String(error));
      }
    }
    propsRef.current.onAttachments(list.slice(0, 10));
  };

  const hasImages = props.attachments.some((a) => a.kind === 'image');
  const canSend = !props.disabled && (props.value.trim().length > 0 || props.attachments.length > 0);

  return (
    <div className="as-composer">
      {props.attachments.length > 0 && (
        <div className="as-attachments as-composer-atts">
          {props.attachments.map((a) => (
            <span key={a.id} className="as-att-chip" title={`${a.name}${a.truncated ? ` (${t('truncated')})` : ''}`}>
              {a.kind === 'image' && a.thumb ? <img src={a.thumb} alt="" /> : <FileText size={13} />}
              <span className="as-att-name">{a.name}</span>
              <button type="button" aria-label={t('Remove attachment')} onClick={() => props.onAttachments(props.attachments.filter((x) => x.id !== a.id))}>
                <X size={12} />
              </button>
            </span>
          ))}
          {hasImages && !props.imagesSupported && <span className="badge warn">{t('This AI cannot see images')}</span>}
        </div>
      )}
      <textarea
        ref={ref}
        className="textarea as-input"
        value={props.value}
        placeholder={props.placeholder ?? t('Message the AI…')}
        disabled={props.disabled}
        rows={2}
        onChange={(e) => props.onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (!props.busy && canSend) props.onSend();
          }
        }}
        onPaste={(e) => {
          const files = Array.from(e.clipboardData.files);
          if (files.length) {
            e.preventDefault();
            void addFiles(files);
          }
        }}
        aria-label={t('Message')}
      />
      <div className="as-composer-bar">
        <IconButton
          icon={Paperclip}
          label={t('Attach images or text files')}
          disabled={props.disabled}
          onClick={async () => {
            const files = await pickFiles({ accept: ATTACH_ACCEPT, multiple: true });
            if (files.length) await addFiles(files);
          }}
        />
        <IconButton icon={BookOpen} label={t('Prompt library')} onClick={props.onOpenTemplates} />
        <span className="faint as-hint">{t('Enter to send · Shift+Enter for a new line')}</span>
        <span className="spacer" />
        {props.busy ? (
          <Button size="sm" icon={Square} onClick={props.onStop}>
            {t('Stop')}
          </Button>
        ) : (
          <Button size="sm" variant="primary" icon={Send} disabled={!canSend} onClick={props.onSend}>
            {t('Send')}
          </Button>
        )}
      </div>
    </div>
  );
}

/** Lets the parent add files (drop / handoff) through the same path. */
export async function filesToAttachments(files: File[], existing: Attachment[]): Promise<Attachment[]> {
  const list = [...existing];
  for (const file of files) {
    if (!isAttachable(file)) continue;
    try {
      list.push(await fileToAttachment(file));
    } catch (error) {
      toast.error(file.name, error instanceof Error ? error.message : String(error));
    }
  }
  return list.slice(0, 10);
}
