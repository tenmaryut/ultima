/** Pure helpers for the export dialog: output size, file names, options. */

export type ExportFormat = 'jpeg' | 'png' | 'webp';
export type ResizeMode = 'none' | 'long' | 'short' | 'megapixels';

export interface ExportOptions {
  format: ExportFormat;
  /** 1..100 (JPEG / WebP). */
  quality: number;
  resize: ResizeMode;
  /** Pixels for long/short edge, megapixels for 'megapixels'. */
  resizeValue: number;
  allowEnlarge: boolean;
  /** e.g. "{name}-edit", "{date}_{n}". */
  template: string;
  /** Copy EXIF (camera, date…) into JPEG files. */
  keepMetadata: boolean;
}

export const DEFAULT_EXPORT: ExportOptions = {
  format: 'jpeg',
  quality: 90,
  resize: 'none',
  resizeValue: 2048,
  allowEnlarge: false,
  template: '{name}',
  keepMetadata: true,
};

export const FORMAT_INFO: Record<ExportFormat, { ext: string; mime: string; label: string }> = {
  jpeg: { ext: 'jpg', mime: 'image/jpeg', label: 'JPEG' },
  png: { ext: 'png', mime: 'image/png', label: 'PNG' },
  webp: { ext: 'webp', mime: 'image/webp', label: 'WebP' },
};

/** Output size (and scale) for a w×h image. */
export function exportSize(w: number, h: number, mode: ResizeMode, value: number, allowEnlarge: boolean): { width: number; height: number; scale: number } {
  let s = 1;
  if (w > 0 && h > 0 && value > 0) {
    if (mode === 'long') s = value / Math.max(w, h);
    else if (mode === 'short') s = value / Math.min(w, h);
    else if (mode === 'megapixels') s = Math.sqrt((value * 1e6) / (w * h));
  }
  if (!allowEnlarge) s = Math.min(1, s);
  s = Math.max(s, 1 / Math.max(w, h, 1));
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)), scale: s };
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

export function formatDate(ms: number): string {
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return 'undated';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}`;
}

/** Characters that are not allowed in file names on Windows/macOS/Linux. */
export function safeFileName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  return cleaned.slice(0, 180) || 'photo';
}

export interface NameInfo {
  /** Original file name without extension. */
  name: string;
  /** 1-based sequence number in this export. */
  n: number;
  /** Number of files in this export (for zero padding). */
  total: number;
  /** Capture/file date, ms. */
  date: number;
  rating?: number;
  width?: number;
  height?: number;
}

/** Applies a file name template: {name} {n} {date} {rating} {width} {height}. */
export function applyTemplate(template: string, info: NameInfo): string {
  const digits = Math.max(2, String(info.total).length);
  const out = (template.trim() || '{name}').replace(/\{(\w+)\}/g, (match, token: string) => {
    switch (token.toLowerCase()) {
      case 'name':
        return info.name;
      case 'n':
        return pad(info.n, digits);
      case 'date':
        return formatDate(info.date);
      case 'rating':
        return String(info.rating ?? 0);
      case 'width':
        return String(info.width ?? '');
      case 'height':
        return String(info.height ?? '');
      default:
        return match;
    }
  });
  return safeFileName(out);
}

/** Makes `name.ext` unique among `used` (adds -2, -3, …) and records it. */
export function uniqueFileName(base: string, ext: string, used: Set<string>): string {
  let candidate = `${base}.${ext}`;
  let i = 2;
  while (used.has(candidate.toLowerCase())) candidate = `${base}-${i++}.${ext}`;
  used.add(candidate.toLowerCase());
  return candidate;
}

export function sanitizeExportOptions(input: unknown): ExportOptions {
  const o = { ...DEFAULT_EXPORT };
  if (!input || typeof input !== 'object') return o;
  const src = input as Record<string, unknown>;
  if (src.format === 'jpeg' || src.format === 'png' || src.format === 'webp') o.format = src.format;
  if (typeof src.quality === 'number') o.quality = Math.max(1, Math.min(100, Math.round(src.quality)));
  if (src.resize === 'none' || src.resize === 'long' || src.resize === 'short' || src.resize === 'megapixels') o.resize = src.resize;
  if (typeof src.resizeValue === 'number' && src.resizeValue > 0) o.resizeValue = Math.min(src.resize === 'megapixels' ? 400 : 32768, src.resizeValue);
  if (typeof src.allowEnlarge === 'boolean') o.allowEnlarge = src.allowEnlarge;
  if (typeof src.template === 'string') o.template = src.template.slice(0, 120);
  if (typeof src.keepMetadata === 'boolean') o.keepMetadata = src.keepMetadata;
  return o;
}

/**
 * Inserts an EXIF APP1 segment (from the original JPEG) into an encoded JPEG, with the
 * orientation tag reset to 1 because the export already has the rotation applied.
 */
export function insertExif(jpeg: Uint8Array, app1: Uint8Array | null): Uint8Array {
  if (!app1 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return jpeg;
  // skip an existing APP0 (JFIF) so EXIF follows it
  let at = 2;
  if (jpeg[2] === 0xff && jpeg[3] === 0xe0) at = 4 + ((jpeg[4] << 8) | jpeg[5]);
  const out = new Uint8Array(jpeg.length + app1.length);
  out.set(jpeg.subarray(0, at), 0);
  out.set(app1, at);
  out.set(jpeg.subarray(at), at + app1.length);
  return out;
}

/** Copies the APP1 Exif segment of a JPEG (marker included), resetting Orientation to 1. */
export function extractExifSegment(jpeg: Uint8Array): Uint8Array | null {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return null;
  let i = 2;
  while (i + 4 <= jpeg.length) {
    if (jpeg[i] !== 0xff) return null;
    const marker = jpeg[i + 1];
    if (marker === 0xda || marker === 0xd9) return null;
    const len = (jpeg[i + 2] << 8) | jpeg[i + 3];
    if (marker === 0xe1 && jpeg[i + 4] === 0x45 && jpeg[i + 5] === 0x78 && jpeg[i + 6] === 0x69 && jpeg[i + 7] === 0x66) {
      const seg = jpeg.slice(i, i + 2 + len);
      resetOrientation(seg, 10);
      return seg;
    }
    i += 2 + len;
  }
  return null;
}

/** Sets EXIF orientation (tag 0x0112 in IFD0) to 1 inside an APP1 segment. */
function resetOrientation(seg: Uint8Array, tiffStart: number): void {
  const le = seg[tiffStart] === 0x49;
  const u16 = (o: number) => (le ? seg[o] | (seg[o + 1] << 8) : (seg[o] << 8) | seg[o + 1]);
  const u32 = (o: number) => (le ? seg[o] | (seg[o + 1] << 8) | (seg[o + 2] << 16) | (seg[o + 3] << 24) : (seg[o] << 24) | (seg[o + 1] << 16) | (seg[o + 2] << 8) | seg[o + 3]) >>> 0;
  if (tiffStart + 8 > seg.length) return;
  const ifd = tiffStart + u32(tiffStart + 4);
  if (ifd + 2 > seg.length) return;
  const count = u16(ifd);
  for (let k = 0; k < count; k++) {
    const e = ifd + 2 + k * 12;
    if (e + 12 > seg.length) return;
    if (u16(e) === 0x0112) {
      if (le) {
        seg[e + 8] = 1;
        seg[e + 9] = 0;
      } else {
        seg[e + 8] = 0;
        seg[e + 9] = 1;
      }
    }
  }
  // unlink IFD1 (the embedded thumbnail shows the unedited photo)
  const next = ifd + 2 + count * 12;
  if (next + 4 <= seg.length) seg.fill(0, next, next + 4);
}
