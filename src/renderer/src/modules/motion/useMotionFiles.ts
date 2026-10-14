import type { MutableRefObject, RefObject } from 'react';
import { useFileDrop, useHandoffs } from '../../core/hooks';
import { useT } from '../../core/i18n';
import { rememberRecent } from '../../core/open';
import { pathForFile, pickFiles } from '../../core/platform';
import { confirmDialog, toast } from '../../components/ui';
import { addMediaLayer, addSvg, applyPalette, importMediaFiles, isProjectFile, loadProject, saveProject } from './files';
import { createLayer, uniqueName } from './model';
import { insertLayers } from './ops';
import { cleanText } from './project';
import type { EditorApi } from './state';
import type { MotionDoc } from './types';

/** Open / import / save, drag & drop and handoffs from other modules. */

export interface FileInfo {
  name: string;
  path?: string;
}

export function useMotionFiles(p: {
  active: boolean;
  rootRef: RefObject<HTMLDivElement | null>;
  docRef: MutableRefObject<MotionDoc>;
  dirty: boolean;
  selected: string[];
  setDoc: EditorApi['setDoc'];
  setSelected: (ids: string[]) => void;
  /** Replaces the whole document (new / open). */
  resetDoc: (doc: MotionDoc, file: FileInfo | null) => void;
  file: FileInfo | null;
  onSaved: (doc: MotionDoc, file: FileInfo) => void;
}) {
  const t = useT();

  const confirmDiscard = async () =>
    !p.dirty || (await confirmDialog({ title: t('Discard unsaved changes?'), message: t('The current animation has unsaved changes.'), confirmLabel: t('Discard'), danger: true }));

  const openProject = async (source: File | unknown, name?: string, path?: string) => {
    if (!(await confirmDiscard())) return;
    try {
      const { doc: next, failed } = await loadProject(source);
      p.resetDoc(next, { name: name ?? `${next.comp.name}.ultima`, path });
      if (failed.length) toast.warning(t('Some media could not be restored'), failed.join(', '));
      else toast.success(t('Project opened'), name);
    } catch (error) {
      toast.error(t('Could not open the project'), t(error instanceof Error ? error.message : String(error)));
    }
  };

  const importFiles = async (files: File[], remember = true) => {
    const project = files.find(isProjectFile);
    if (project) {
      if (remember) rememberRecent(project, 'motion');
      await openProject(project, project.name, pathForFile(project));
      return;
    }
    const r = await importMediaFiles(p.docRef.current, files, p.selected);
    if (r.added.length) {
      p.setDoc(r.doc, { label: 'Import' });
      p.setSelected(r.added.slice(0, 1));
      if (remember) files.forEach((f) => rememberRecent(f, 'motion'));
      toast.success(t('{n} layer(s) added', { n: r.added.length }));
    }
    if (r.errors.length) toast.error(t('Some files could not be imported'), r.errors.map((e) => t(e)).join('\n'));
  };

  const pickImport = async () => {
    const files = await pickFiles({ accept: 'image/*,video/*,.svg,.mp4,.webm,.mov', multiple: true });
    if (files.length) await importFiles(files);
  };

  const pickOpen = async () => {
    const files = await pickFiles({ accept: '.ultima,image/*,video/*,.svg', multiple: true });
    if (files.length) await importFiles(files);
  };

  const save = async (saveAs: boolean) => {
    const current = p.docRef.current;
    try {
      const res = await saveProject(current, p.file?.name ?? current.comp.name, saveAs ? undefined : p.file?.path);
      if (!res) return;
      p.onSaved(current, { name: `${(p.file?.name ?? current.comp.name).replace(/\.ultima$/i, '')}.ultima`, path: res.path ?? p.file?.path });
      toast.success(t('Project saved'));
    } catch (error) {
      toast.error(t('Could not save the project'), error instanceof Error ? error.message : String(error));
    }
  };

  const dragging = useFileDrop(p.rootRef, (files) => void importFiles(files), p.active);

  useHandoffs('motion', (items) => {
    void (async () => {
      for (const item of items) {
        try {
          if (item.kind === 'files' && item.files?.length) await importFiles(item.files, false);
          else if (item.kind === 'text' && item.text) {
            const d = p.docRef.current;
            const layer = createLayer('text', d.comp, { text: cleanText(item.text, 2000) }, d.layers.length);
            layer.name = uniqueName(d, layer.name);
            p.setDoc(insertLayers(d, [layer], []), { label: 'Text from handoff' });
            p.setSelected([layer.id]);
          } else if (item.kind === 'svg' && item.svg) {
            const r = await addSvg(p.docRef.current, item.svg, item.title ?? 'SVG', []);
            p.setDoc(r.doc, { label: 'Import SVG' });
            p.setSelected(r.ids.slice(0, 1));
          } else if (item.kind === 'image' && item.image) {
            const blob = await (await fetch(item.image)).blob();
            const r = await addMediaLayer(p.docRef.current, blob, item.title ?? 'Image', 'image', []);
            p.setDoc(r.doc, { label: 'Import image' });
            p.setSelected([r.layer.id]);
          } else if (item.kind === 'palette' && item.palette?.length) {
            const r = applyPalette(p.docRef.current, item.palette, p.selected);
            p.setDoc(r.doc, { label: 'Apply palette' });
            toast.success(t('Palette applied to {n} layer(s)', { n: r.count }));
          } else if (item.kind === 'json' && item.json) await openProject(item.json, item.title);
        } catch (error) {
          toast.error(t('Could not open what was sent here'), error instanceof Error ? error.message : String(error));
        }
      }
    })();
  });

  return { dragging, confirmDiscard, importFiles, pickImport, pickOpen, save };
}
