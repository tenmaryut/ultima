import { useState } from 'react';
import { FileSearch, Film, Image as ImageIcon, Music } from 'lucide-react';
import type { MediaRef, Project, ProjectSettings } from '../types';
import { useT } from '../../../core/i18n';
import { Button, ColorPicker, Field, Modal, NumberField, Select, TextInput, toast } from '../../../components/ui';
import { pickFiles } from '../../../core/platform';
import { fileBaseName, formatBytes } from '../../../core/utils/format';
import { FPS_OPTIONS, RESOLUTION_PRESETS, presetIdFor } from '../presets';
import { MEDIA_ACCEPT, type MediaLibrary } from '../media';

export function ProjectSettingsDialog({
  project,
  onApply,
  onClose,
}: {
  project: Project;
  onApply: (settings: ProjectSettings, name: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [name, setName] = useState(project.name);
  const [s, setS] = useState<ProjectSettings>(project.settings);
  const preset = presetIdFor(s.width, s.height);
  const even = (v: number) => Math.max(16, Math.min(7680, Math.round(v / 2) * 2));
  return (
    <Modal
      title={t('Project settings')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancel')}</Button>
          <Button
            variant="primary"
            onClick={() => {
              onApply({ ...s, width: even(s.width), height: even(s.height) }, name.trim() || project.name);
              onClose();
            }}
          >
            {t('Apply')}
          </Button>
        </>
      }
    >
      <Field label={t('Name')}>
        <TextInput value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label={t('Resolution')}>
        <Select<string>
          value={preset}
          onChange={(id) => {
            const p = RESOLUTION_PRESETS.find((x) => x.id === id);
            if (p) setS({ ...s, width: p.width, height: p.height });
          }}
          options={[...RESOLUTION_PRESETS.map((p) => ({ value: p.id, label: t(p.label) })), { value: 'custom', label: t('Custom') }]}
        />
      </Field>
      <div className="vd-dialog-grid">
        <Field label={t('Width')}>
          <NumberField value={s.width} min={16} max={7680} step={2} suffix="px" onChange={(width) => setS({ ...s, width })} />
        </Field>
        <Field label={t('Height')}>
          <NumberField value={s.height} min={16} max={7680} step={2} suffix="px" onChange={(height) => setS({ ...s, height })} />
        </Field>
        <Field label={t('Frame rate')}>
          <Select<number> value={s.fps} onChange={(fps) => setS({ ...s, fps })} options={FPS_OPTIONS.map((f) => ({ value: f, label: `${f} fps` }))} />
        </Field>
        <Field label={t('Background')}>
          <div className="row">
            <ColorPicker value={s.background} alpha={false} onChange={(background) => setS({ ...s, background })} label={t('Background color')} />
            <span className="mono faint">{s.background}</span>
          </div>
        </Field>
      </div>
      <div className="vd-hint">{t('You can change these at any time — clip positions and text sizes are adapted to the new frame.')}</div>
    </Modal>
  );
}

const ICON = { video: Film, audio: Music, image: ImageIcon };

/** Asks the user for the files of a project's missing media and matches them by name. */
export function RelinkDialog({
  project,
  lib,
  onRelinked,
  onClose,
}: {
  project: Project;
  lib: MediaLibrary;
  onRelinked: (refs: MediaRef[]) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const missing = project.media.filter((m) => !lib.has(m.id));

  const locate = async () => {
    const files = await pickFiles({ accept: MEDIA_ACCEPT, multiple: true });
    if (!files.length) return;
    setBusy(true);
    const updated: MediaRef[] = [];
    const used = new Set<File>();
    try {
      for (const ref of missing) {
        const name = ref.name.toLowerCase();
        const candidates = files.filter((f) => !used.has(f) && f.name.toLowerCase() === name);
        const loose = candidates.length ? candidates : files.filter((f) => !used.has(f) && fileBaseName(f.name).toLowerCase() === fileBaseName(ref.name).toLowerCase());
        const file = loose.find((f) => f.size === ref.size) ?? loose[0];
        if (!file) continue;
        try {
          const fresh = await lib.relink(ref, file);
          if (fresh.kind !== ref.kind) {
            lib.remove(ref.id);
            toast.warning(t('{name} is a different kind of file', { name: file.name }));
            continue;
          }
          used.add(file);
          updated.push({ ...ref, ...fresh, id: ref.id });
        } catch (error) {
          toast.error(t('Could not open {name}', { name: file.name }), error instanceof Error ? error.message : String(error));
        }
      }
      if (updated.length) {
        onRelinked(updated);
        toast.success(t('Relinked {count} file(s)', { count: updated.length }));
      } else toast.warning(t('None of the picked files match the missing media names.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t('Relink missing media')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{missing.length ? t('Later') : t('Close')}</Button>
          <Button variant="primary" icon={FileSearch} disabled={busy || !missing.length} onClick={locate}>
            {t('Locate files…')}
          </Button>
        </>
      }
    >
      {missing.length ? (
        <>
          <div>{t('This project uses media files that are not loaded. Pick them (you can select several at once) — they are matched by file name.')}</div>
          <div className="vd-missing-list">
            {missing.map((m) => {
              const Icon = ICON[m.kind];
              return (
                <div key={m.id}>
                  <Icon size={14} />
                  <span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m.path ?? m.name}>
                    {m.name}
                    {m.path && <span className="faint"> — {m.path}</span>}
                  </span>
                  <span className="faint">{formatBytes(m.size)}</span>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div>{t('All media files are linked.')}</div>
      )}
    </Modal>
  );
}
