import { moduleForFile, moduleForProjectFile } from './modules';
import { useAppStore, type ModuleId } from './store';
import { desktop, pathForFile, pickFiles } from './platform';
import { fileExtension } from './utils/format';
import { toast } from '../components/ui/feedback';
import { t } from './i18n';

export const ANY_SUPPORTED_ACCEPT =
  'image/*,video/*,audio/*,application/pdf,.psd,.svg,.ultima,.mkv,.mov,.flac,.m4a,.opus,.ase,.gpl,.tif,.tiff,.dng,.cr2,.cr3,.nef,.arw,.raf,.orf,.rw2,.pef,.srw';

/** Records a file in the recent list (and in the desktop app's recent list with its path). */
/** Paths of File objects we created ourselves from a known path (they have no native path). */
const knownPaths = new WeakMap<File, string>();

export function rememberRecent(file: File, moduleId: ModuleId): void {
  const path = knownPaths.get(file) ?? pathForFile(file);
  useAppStore.getState().addRecent({ name: file.name, moduleId, path });
  if (desktop && path) void desktop.files.addRecent({ path, name: file.name, moduleId });
}

/** Routes files to the module that can open them (Home "Open…", drag & drop, recent files). */
export async function openFilesInApp(files: File[]): Promise<void> {
  const groups = new Map<ModuleId, File[]>();
  const unknown: string[] = [];
  for (const file of files) {
    let id = moduleForFile(file);
    if (!id && fileExtension(file.name) === 'ultima') id = await moduleForProjectFile(file);
    if (!id) {
      unknown.push(file.name);
      continue;
    }
    groups.set(id, [...(groups.get(id) ?? []), file]);
  }
  if (unknown.length) toast.warning(t('Unsupported file type'), unknown.join(', '));
  const store = useAppStore.getState();
  for (const [id, list] of groups) {
    list.forEach((f) => rememberRecent(f, id));
    store.sendToModule(id, { kind: 'files', files: list });
  }
}

export async function pickAndOpenFiles(): Promise<void> {
  const files = await pickFiles({ accept: ANY_SUPPORTED_ACCEPT, multiple: true });
  if (files.length) await openFilesInApp(files);
}

/** Re-opens a recent file by path (desktop only). */
export async function openRecentPath(path: string, name: string): Promise<boolean> {
  if (!desktop) return false;
  const data = await desktop.files.readRecent(path);
  if (!data) {
    toast.error(t('Could not open file'), path);
    return false;
  }
  const file = new File([data], name, { type: guessMime(name) });
  knownPaths.set(file, path);
  await openFilesInApp([file]);
  return true;
}

export function guessMime(name: string): string {
  const ext = fileExtension(name);
  const map: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp',
    avif: 'image/avif', svg: 'image/svg+xml', psd: 'image/vnd.adobe.photoshop', ico: 'image/x-icon',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska', m4v: 'video/mp4', ogv: 'video/ogg',
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', flac: 'audio/flac', m4a: 'audio/mp4',
    aac: 'audio/aac', opus: 'audio/opus', weba: 'audio/webm', pdf: 'application/pdf', ultima: 'application/json',
    json: 'application/json', txt: 'text/plain', srt: 'text/plain', vtt: 'text/vtt',
  };
  return map[ext] ?? 'application/octet-stream';
}
