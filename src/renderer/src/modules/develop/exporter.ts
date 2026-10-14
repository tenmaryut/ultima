/**
 * Export: renders each selected photo at full (or resized) resolution through the tiled
 * GPU pipeline, encodes JPEG / PNG / WebP (optionally keeping EXIF) and saves one file or
 * a ZIP of all of them.
 */
import JSZip from 'jszip';
import { saveFile } from '../../core/platform';
import { t } from '../../core/i18n';
import { fileBaseName } from '../../core/utils/format';
import { canvasToBlob } from '../../core/utils/image';
import { decodeFull, getStats, peekFull } from './decode';
import { applyTemplate, exportSize, extractExifSegment, formatDate, FORMAT_INFO, insertExif, uniqueFileName, type ExportOptions } from './export-utils';
import { geometry } from './geometry';
import { AbortError, renderToCanvas } from './render';
import { getPhoto } from './store';
import { canDevelop, type Photo } from './types';

export interface ExportProgress {
  /** 0..1 over the whole export. */
  value: number;
  label: string;
}

export interface ExportResult {
  exported: number;
  failed: { name: string; error: string }[];
  saved: boolean;
}

async function encode(photo: Photo, options: ExportOptions, signal: AbortSignal, onTile: (v: number) => void): Promise<{ blob: Blob; width: number; height: number }> {
  const cached = peekFull(photo);
  const full = cached ?? (await decodeFull(photo));
  try {
    const stats = await getStats(photo).catch(() => null);
    const geo = geometry(photo.settings, full.width, full.height);
    const size = exportSize(geo.outW, geo.outH, options.resize, options.resizeValue, options.allowEnlarge);
    const canvas = await renderToCanvas({
      full,
      key: `export:${photo.id}`,
      settings: photo.settings,
      atmos: stats?.atmos ?? [1, 1, 1],
      scale: size.scale,
      signal,
      onProgress: (done, total) => onTile(done / total),
    });
    const info = FORMAT_INFO[options.format];
    let blob = await canvasToBlob(canvas, info.mime, options.format === 'png' ? undefined : options.quality / 100);
    canvas.width = canvas.height = 1;
    if (options.format === 'jpeg' && options.keepMetadata && photo.source && photo.kind !== 'tiff') {
      const head = new Uint8Array(await photo.source.slice(0, 128 * 1024).arrayBuffer());
      const app1 = extractExifSegment(head);
      if (app1) blob = new Blob([insertExif(new Uint8Array(await blob.arrayBuffer()), app1) as BlobPart], { type: info.mime });
    }
    return { blob, width: size.width, height: size.height };
  } finally {
    if (!cached) full.close();
  }
}

export async function exportPhotos(
  ids: string[],
  options: ExportOptions,
  onProgress: (p: ExportProgress) => void,
  signal: AbortSignal,
): Promise<ExportResult> {
  const photos = ids.map((id) => getPhoto(id)).filter((p): p is Photo => Boolean(p) && canDevelop(p!));
  const failed: ExportResult['failed'] = [];
  if (!photos.length) return { exported: 0, failed, saved: false };
  const info = FORMAT_INFO[options.format];
  const used = new Set<string>();
  const outputs: { name: string; blob: Blob }[] = [];
  for (let i = 0; i < photos.length; i++) {
    if (signal.aborted) throw new AbortError();
    const p = photos[i];
    const base = (v: number) => (i + v) / photos.length;
    onProgress({ value: base(0), label: t('Rendering {name} ({n}/{total})', { name: p.name, n: i + 1, total: photos.length }) });
    try {
      const out = await encode(p, options, signal, (v) => onProgress({ value: base(v * 0.95), label: t('Rendering {name} ({n}/{total})', { name: p.name, n: i + 1, total: photos.length }) }));
      const stem = applyTemplate(options.template, {
        name: fileBaseName(p.name) + (p.copyIndex ? `-${p.copyIndex}` : ''),
        n: i + 1,
        total: photos.length,
        date: p.captureDate,
        rating: p.rating,
        width: out.width,
        height: out.height,
      });
      outputs.push({ name: uniqueFileName(stem, info.ext, used), blob: out.blob });
    } catch (error) {
      if (error instanceof AbortError || signal.aborted) throw new AbortError();
      failed.push({ name: p.name, error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (!outputs.length) return { exported: 0, failed, saved: false };
  if (outputs.length === 1) {
    onProgress({ value: 1, label: t('Saving…') });
    const res = await saveFile(outputs[0].blob, { suggestedName: outputs[0].name, filters: [{ name: info.label, extensions: [info.ext] }] });
    return { exported: 1, failed, saved: Boolean(res) };
  }
  onProgress({ value: 0.99, label: t('Creating ZIP…') });
  const zip = new JSZip();
  for (const o of outputs) zip.file(o.name, o.blob, { compression: 'STORE' });
  const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
  const res = await saveFile(zipBlob, { suggestedName: `Ultima-export-${formatDate(Date.now())}.zip`, filters: [{ name: 'ZIP', extensions: ['zip'] }] });
  return { exported: outputs.length, failed, saved: Boolean(res) };
}
