/**
 * Renders the queued PDF Studio dialogs (password prompt, open-files choice).
 */
import { useEffect, useRef, useState } from 'react';
import { Combine, FilePlus, FileText, KeyRound, Lock } from 'lucide-react';
import { useT } from '../../../core/i18n';
import { Button, Modal } from '../../../components/ui';
import { closeDialog, usePdfDialogs, type DialogRequest, type OpenChoice } from './dialogStore';

function PasswordDialog({ req }: { req: Extract<DialogRequest, { kind: 'password' }> }) {
  const t = useT();
  const [value, setValue] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setTimeout(() => ref.current?.focus(), 30);
  }, []);
  const finish = (result: string | null) => {
    closeDialog(req);
    req.resolve(result);
  };
  return (
    <Modal
      title={
        <span className="row" style={{ gap: 8 }}>
          <Lock size={16} /> {t('Password required')}
        </span>
      }
      onClose={() => finish(null)}
      footer={
        <>
          <Button onClick={() => finish(null)}>{t('Cancel')}</Button>
          <Button variant="primary" icon={KeyRound} onClick={() => finish(value)} disabled={!value}>
            {t('Open')}
          </Button>
        </>
      }
    >
      <div className="selectable">{t('"{name}" is protected. Enter the password to open it.', { name: req.fileName })}</div>
      {req.incorrect && <div className="pd-error-text">{t('Incorrect password. Please try again.')}</div>}
      <input
        ref={ref}
        className="input"
        type="password"
        autoComplete="off"
        aria-label={t('Password')}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && value) finish(value);
        }}
      />
    </Modal>
  );
}

function OpenDialog({ req }: { req: Extract<DialogRequest, { kind: 'open' }> }) {
  const t = useT();
  const finish = (result: OpenChoice | null) => {
    closeDialog(req);
    req.resolve(result);
  };
  const many = req.fileNames.length > 1;
  const options: { value: OpenChoice; icon: typeof Combine; title: string; text: string }[] = [];
  if (many) options.push({ value: 'combine', icon: Combine, title: t('Combine into one PDF'), text: t('Merge all {count} files into a new document, in this order.', { count: req.fileNames.length }) });
  if (req.hasDocument) {
    options.push({ value: 'insert-end', icon: FilePlus, title: t('Add to the end of this document'), text: t('Insert the pages after the last page.') });
    options.push({ value: 'insert-after', icon: FilePlus, title: t('Insert after the current page'), text: t('Insert the pages after the page you are viewing.') });
  }
  options.push(
    many
      ? { value: 'first', icon: FileText, title: t('Open only the first file'), text: req.fileNames[0] }
      : { value: 'new', icon: FileText, title: t('Open as a new document'), text: t('Close the current document and open this file.') },
  );
  return (
    <Modal title={many ? t('Open {count} files', { count: req.fileNames.length }) : t('Open file')} onClose={() => finish(null)} footer={<Button onClick={() => finish(null)}>{t('Cancel')}</Button>}>
      <div className="pd-file-list faint">{req.fileNames.slice(0, 8).join(' · ')}{req.fileNames.length > 8 ? ' …' : ''}</div>
      <div className="col" style={{ gap: 8 }}>
        {options.map((o, i) => (
          <button key={o.value} type="button" className={`pd-choice ${i === 0 ? 'primary' : ''}`} onClick={() => finish(o.value)} autoFocus={i === 0}>
            <o.icon size={18} />
            <span className="col" style={{ gap: 2, alignItems: 'flex-start' }}>
              <strong>{o.title}</strong>
              <span className="muted" style={{ fontSize: 12 }}>
                {o.text}
              </span>
            </span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

export function PdfDialogHost() {
  const current = usePdfDialogs((s) => s.queue[0]);
  if (!current) return null;
  if (current.kind === 'password') return <PasswordDialog key={current.id} req={current} />;
  return <OpenDialog key={current.id} req={current} />;
}
