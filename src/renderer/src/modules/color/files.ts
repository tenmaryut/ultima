/**
 * File handling for Color Studio: open/save projects, import palettes and images,
 * plus the saved-palette library hook.
 */
import { useRef, useState, type RefObject } from 'react';
import { toast } from '../../components/ui';
import { pathForFile, pickFiles, saveFile } from '../../core/platform';
import { rememberRecent } from '../../core/open';
import { t } from '../../core/i18n';
import type { HistoryState } from '../../core/history';
import { loadImage } from '../../core/utils/image';
import { fileExtension } from '../../core/utils/format';
import { uid } from '../../core/utils/id';
import { importPalette, parseColorsFromText, parsePaletteJson, slugify, type PaletteData } from './io';
import { MAX_SWATCHES, parseProject, replaceColors, serializeProject, type ColorDoc } from './state';
import { prepareImage, type LoadedImage } from './render';
import { loadLibrary, storeLibrary, type SavedPalette } from './library';

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'svg', 'ico'];
export const OPEN_ACCEPT = '.ultima,.ase,.gpl,.json,.css,.scss,.sass,.less,.js,.ts,.txt,.svg,image/*';
const LIBRARY_ACCEPT = '.ase,.gpl,.json,.ultima,.css,.scss,.sass,.less,.js,.ts,.txt';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function useColorFiles(options: {
  history: HistoryState<ColorDoc>;
  docRef: RefObject<ColorDoc>;
  onImageLoaded: (image: LoadedImage, extract: boolean) => void;
  onPalette: (name: string) => void;
}) {
  const opts = useRef(options);
  opts.current = options;
  const [image, setImage] = useState<LoadedImage | null>(null);
  const imageRef = useRef<LoadedImage | null>(null);
  const [savedDoc, setSavedDoc] = useState<ColorDoc>(options.history.present);
  const pathRef = useRef<string | undefined>(undefined);

  const setLoadedImage = (next: LoadedImage | null) => {
    if (imageRef.current && imageRef.current !== next) URL.revokeObjectURL(imageRef.current.url);
    imageRef.current = next;
    setImage(next);
  };

  const loadImageSource = async (source: Blob | string, extract = true): Promise<boolean> => {
    try {
      const el = await loadImage(source);
      const prepared = await prepareImage(el);
      setLoadedImage(prepared);
      opts.current.onImageLoaded(prepared, extract);
      return true;
    } catch (error) {
      toast.error(t('Could not open the image'), errorText(error));
      return false;
    }
  };

  const applyPalette = (p: PaletteData, label = 'Import palette') => {
    if (!p.colors.length) throw new Error(t('No colors found in this file'));
    const { history, docRef } = opts.current;
    const next = replaceColors(docRef.current, p.colors.slice(0, 12), { keepLocked: false });
    history.set({ ...next, name: (p.name || next.name).slice(0, 120) }, { label });
    opts.current.onPalette(p.name);
    if (p.colors.length > 12) toast.info(t('Only the first 12 colors were imported'), t('{count} colors in the file', { count: p.colors.length }));
  };

  const openProject = async (file: File) => {
    const { doc, image: dataUrl } = parseProject(await file.text());
    opts.current.history.reset(doc);
    setSavedDoc(doc);
    pathRef.current = pathForFile(file);
    if (dataUrl) await loadImageSource(dataUrl, false);
    else setLoadedImage(null);
    opts.current.onPalette('');
  };

  const openFiles = async (files: File[]) => {
    for (const file of files) {
      const ext = fileExtension(file.name);
      try {
        if (ext === 'ultima') {
          await openProject(file);
          rememberRecent(file, 'color');
        } else if (IMAGE_EXT.includes(ext) || file.type.startsWith('image/')) {
          if (await loadImageSource(file, true)) rememberRecent(file, 'color');
        } else {
          applyPalette(importPalette(file.name, new Uint8Array(await file.arrayBuffer())));
          rememberRecent(file, 'color');
        }
      } catch (error) {
        toast.error(t('Could not open {name}', { name: file.name }), errorText(error));
      }
    }
  };

  const importText = (text: string, title?: string) => {
    try {
      let p: PaletteData | null = null;
      if (/^\s*[[{]/.test(text)) {
        try {
          p = parsePaletteJson(text);
        } catch {
          p = null;
        }
      }
      if (!p || !p.colors.length) p = { name: title ?? '', colors: parseColorsFromText(text).map((hex) => ({ hex })) };
      if (!p.colors.length) {
        toast.warning(t('No colors found'), t('The text does not contain any hex or rgb() colors.'));
        return;
      }
      applyPalette({ ...p, name: p.name || title || '' });
    } catch (error) {
      toast.error(t('Could not import the colors'), errorText(error));
    }
  };

  const save = async (saveAs: boolean) => {
    const doc = opts.current.docRef.current;
    try {
      const data = serializeProject(doc, imageRef.current?.dataUrl);
      const result = await saveFile(data, {
        suggestedName: `${slugify(doc.name, 'palette')}.ultima`,
        filters: [{ name: t('Ultima project'), extensions: ['ultima'] }],
        path: saveAs ? undefined : pathRef.current,
      });
      if (!result) return;
      if (result.path) pathRef.current = result.path;
      setSavedDoc(doc);
      toast.success(t('Saved'), result.path ?? `${slugify(doc.name, 'palette')}.ultima`);
    } catch (error) {
      toast.error(t('Could not save'), errorText(error));
    }
  };

  return {
    image,
    imageRef,
    dirty: options.history.present !== savedDoc,
    openFiles,
    importText,
    save,
    loadImageUrl: (url: string) => loadImageSource(url, true),
    openDialog: async () => {
      const files = await pickFiles({ accept: OPEN_ACCEPT });
      if (files.length) await openFiles(files);
    },
    openImageDialog: async () => {
      const files = await pickFiles({ accept: 'image/*' });
      if (files.length) await openFiles(files);
    },
    clearImage: () => {
      setLoadedImage(null);
      const { history, docRef } = opts.current;
      if (docRef.current.swatches.some((s) => s.point)) {
        history.set({ ...docRef.current, swatches: docRef.current.swatches.map((s) => ({ ...s, point: undefined })) }, { label: 'Remove image' });
      }
    },
    /** New document: forget the image and the save path. */
    reset: (fresh: ColorDoc) => {
      setLoadedImage(null);
      pathRef.current = undefined;
      setSavedDoc(fresh);
    },
  };
}

/** Saved palettes, persisted in localStorage. */
export function useLibrary() {
  const [library, setLibrary] = useState<SavedPalette[]>(loadLibrary);
  const [currentId, setCurrentId] = useState<string | null>(null);
  // Async imports read files first; they must add to the list as it is then, not as it was.
  const latest = useRef(library);
  latest.current = library;
  const persist = (next: SavedPalette[]) => {
    setLibrary(next);
    if (!storeLibrary(next)) toast.error(t('Could not save the library'), t('The browser storage is full. Delete a few palettes and try again.'));
  };
  return {
    library,
    currentId,
    setCurrentId,
    saveDoc: (doc: ColorDoc) => {
      const now = Date.now();
      const colors = doc.swatches.map((s) => ({ hex: s.hex, name: s.name || undefined }));
      const existing = library.find((p) => p.id === currentId);
      if (existing) {
        persist(library.map((p) => (p.id === existing.id ? { ...p, name: doc.name, tags: [...doc.tags], colors, updatedAt: now } : p)));
        toast.success(t('Library updated'), doc.name);
        return;
      }
      const entry: SavedPalette = { id: uid('pal'), name: doc.name, tags: [...doc.tags], colors, createdAt: now, updatedAt: now };
      persist([entry, ...library]);
      setCurrentId(entry.id);
      toast.success(t('Saved to library'), doc.name);
    },
    add: (p: SavedPalette) => persist([p, ...library]),
    /** Library "Import…": palette files go straight into the library; the editor is untouched. */
    importFiles: async () => {
      const files = await pickFiles({ accept: LIBRARY_ACCEPT, multiple: true });
      const now = Date.now();
      const added: SavedPalette[] = [];
      let truncated = false;
      for (const file of files) {
        try {
          const p = importPalette(file.name, new Uint8Array(await file.arrayBuffer()));
          if (!p.colors.length) throw new Error(t('No colors found in this file'));
          truncated ||= p.colors.length > MAX_SWATCHES;
          const colors = p.colors.slice(0, MAX_SWATCHES).map((c) => ({ hex: c.hex, name: c.name || undefined }));
          added.push({ id: uid('pal'), name: p.name || file.name, tags: [], colors, createdAt: now, updatedAt: now });
        } catch (error) {
          toast.error(t('Could not open {name}', { name: file.name }), errorText(error));
        }
      }
      if (!added.length) return;
      persist([...added, ...latest.current]);
      toast.success(t('{count} palette(s) added to the library', { count: added.length }), truncated ? t('Only the first 12 colors were imported') : undefined);
    },
    update: (p: SavedPalette) => persist(library.map((x) => (x.id === p.id ? p : x))),
    remove: (p: SavedPalette) => {
      persist(library.filter((x) => x.id !== p.id));
      if (currentId === p.id) setCurrentId(null);
    },
  };
}
