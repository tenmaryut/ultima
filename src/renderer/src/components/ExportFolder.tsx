import { useEffect, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import type { ExportFolderInfo } from '@shared/ipc';
import { desktop } from '../core/platform';
import { useT } from '../core/i18n';
import { Button, Field, TextInput, Toggle, toast } from './ui';

/* Where exports are saved without a dialog (desktop app): the folder, a way to change it, and "ask every time". */

export function useExportFolder(): [ExportFolderInfo | null, (info: ExportFolderInfo) => void] {
  const [info, setInfo] = useState<ExportFolderInfo | null>(null);
  useEffect(() => {
    let alive = true;
    void desktop?.files
      .exportFolder()
      .then((i) => alive && setInfo(i))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return [info, setInfo];
}

/** Opens the export folder, or shows the file that was just exported in it. */
export function showExport(path?: string): void {
  if (!desktop) return;
  const done = path ? desktop.app.showItemInFolder(path) : desktop.files.openExportFolder();
  void done.catch((error: unknown) => toast.error(String(error instanceof Error ? error.message : error)));
}

/** The export folder with Change… / Open (/ Reset) and the "ask every time" switch. `info` comes from `useExportFolder`. */
export function ExportFolderSettings({ info, onChange: setInfo, compact }: { info: ExportFolderInfo | null; onChange: (info: ExportFolderInfo) => void; compact?: boolean }) {
  const t = useT();
  if (!desktop || !info) return null;
  const api = desktop;
  const change = async () => {
    const next = await api.files.chooseExportFolder().catch(() => null);
    if (next) setInfo(next);
  };
  return (
    <div className="col" style={{ gap: 8 }}>
      <Field label={compact ? t('Save to') : t('Export folder')}>
        <div className="row" style={{ gap: 6 }}>
          <TextInput readOnly value={info.path} title={info.path} className="grow" style={{ minWidth: 0 }} aria-label={t('Export folder')} />
          <Button size="sm" onClick={() => void change()}>
            {t('Change…')}
          </Button>
          <Button size="sm" icon={FolderOpen} title={t('Open the export folder')} aria-label={t('Open the export folder')} onClick={() => showExport()} />
          {!compact && !info.isDefault && (
            <Button size="sm" onClick={() => void api.files.setExportFolder({ reset: true }).then(setInfo)}>
              {t('Reset')}
            </Button>
          )}
        </div>
      </Field>
      <Toggle
        checked={info.ask}
        onChange={(ask) => void api.files.setExportFolder({ ask }).then(setInfo)}
        label={compact ? t('Ask where to save every time') : t('Ask where to save every export (otherwise exports go straight into this folder, and the AI can export by itself)')}
      />
    </div>
  );
}
