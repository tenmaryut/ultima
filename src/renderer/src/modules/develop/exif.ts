/**
 * Small, dependency-free metadata reader:
 *  - EXIF (camera, lens, exposure, date, orientation, GPS, embedded thumbnail) from JPEG
 *    APP1 segments and TIFF-based files (TIFF, DNG, CR2, NEF, ARW, ...).
 *  - Image dimensions for JPEG / PNG / GIF / WebP / BMP / TIFF / AVIF / HEIC headers.
 *  - Embedded JPEG previews inside RAW files (TIFF IFD walk + byte scan fallback).
 * Pure functions over Uint8Array (unit tested).
 */

export interface ExifInfo {
  make?: string;
  model?: string;
  lens?: string;
  software?: string;
  artist?: string;
  copyright?: string;
  /** "YYYY:MM:DD HH:MM:SS" as written by the camera. */
  dateTime?: string;
  /** Capture time in ms (interpreted as local time). */
  date?: number;
  iso?: number;
  /** Seconds. */
  exposureTime?: number;
  fNumber?: number;
  focalLength?: number;
  focalLength35?: number;
  exposureBias?: number;
  flash?: boolean;
  orientation?: number;
  pixelWidth?: number;
  pixelHeight?: number;
  gps?: { lat: number; lon: number };
  /** Embedded thumbnail (absolute byte range in the parsed buffer). */
  thumbnail?: { offset: number; length: number };
}

export type ImageFormat = 'jpeg' | 'png' | 'gif' | 'webp' | 'bmp' | 'tiff' | 'avif' | 'heic' | 'raw' | 'unknown';

export const RAW_EXTENSIONS = ['cr2', 'cr3', 'crw', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'dng', 'raf', 'orf', 'rw2', 'pef', 'srw', 'x3f', '3fr', 'erf', 'kdc', 'mos', 'mrw', 'iiq', 'rwl', 'raw'];

interface Entry {
  tag: number;
  type: number;
  count: number;
  /** Absolute offset of the value bytes. */
  at: number;
}

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4 };

class TiffReader {
  constructor(
    readonly bytes: Uint8Array,
    /** Absolute offset of the TIFF header ("II*\0" / "MM\0*"). */
    readonly base: number,
    readonly le: boolean,
  ) {}

  inRange(abs: number, len: number): boolean {
    return abs >= 0 && abs + len <= this.bytes.length;
  }

  u8(abs: number): number {
    return this.bytes[abs];
  }

  u16(abs: number): number {
    const b = this.bytes;
    return this.le ? b[abs] | (b[abs + 1] << 8) : (b[abs] << 8) | b[abs + 1];
  }

  u32(abs: number): number {
    const b = this.bytes;
    return this.le
      ? (b[abs] | (b[abs + 1] << 8) | (b[abs + 2] << 16) | (b[abs + 3] << 24)) >>> 0
      : ((b[abs] << 24) | (b[abs + 1] << 16) | (b[abs + 2] << 8) | b[abs + 3]) >>> 0;
  }

  /** Reads an IFD (offset relative to the TIFF header). Returns entries + next IFD offset. */
  readIfd(rel: number): { entries: Map<number, Entry>; next: number } | null {
    const abs = this.base + rel;
    if (!this.inRange(abs, 2)) return null;
    const count = this.u16(abs);
    if (count === 0 || count > 1000 || !this.inRange(abs + 2, count * 12 + 4)) return null;
    const entries = new Map<number, Entry>();
    for (let i = 0; i < count; i++) {
      const e = abs + 2 + i * 12;
      const tag = this.u16(e);
      const type = this.u16(e + 2);
      const n = this.u32(e + 4);
      const size = (TYPE_SIZE[type] ?? 1) * n;
      const at = size <= 4 ? e + 8 : this.base + this.u32(e + 8);
      if (size > 4 && !this.inRange(at, Math.min(size, 64))) continue;
      entries.set(tag, { tag, type, count: n, at });
    }
    return { entries, next: this.u32(abs + 2 + count * 12) };
  }

  number(e: Entry | undefined, index = 0): number | undefined {
    if (!e || index >= e.count) return undefined;
    const size = TYPE_SIZE[e.type] ?? 1;
    const at = e.at + index * size;
    if (!this.inRange(at, size)) return undefined;
    switch (e.type) {
      case 1:
      case 7:
        return this.u8(at);
      case 6:
        return (this.u8(at) << 24) >> 24;
      case 3:
        return this.u16(at);
      case 8:
        return (this.u16(at) << 16) >> 16;
      case 4:
      case 13:
        return this.u32(at);
      case 9:
        return this.u32(at) | 0;
      case 5: {
        const d = this.u32(at + 4);
        return d ? this.u32(at) / d : undefined;
      }
      case 10: {
        const d = this.u32(at + 4) | 0;
        return d ? (this.u32(at) | 0) / d : undefined;
      }
      case 11:
        return new DataView(this.bytes.buffer, this.bytes.byteOffset + at, 4).getFloat32(0, this.le);
      case 12:
        return new DataView(this.bytes.buffer, this.bytes.byteOffset + at, 8).getFloat64(0, this.le);
      default:
        return undefined;
    }
  }

  numbers(e: Entry | undefined, max = 1024): number[] {
    if (!e) return [];
    const out: number[] = [];
    for (let i = 0; i < Math.min(e.count, max); i++) {
      const v = this.number(e, i);
      if (v === undefined) break;
      out.push(v);
    }
    return out;
  }

  string(e: Entry | undefined): string | undefined {
    if (!e || (e.type !== 2 && e.type !== 7 && e.type !== 1)) return undefined;
    const len = Math.min(e.count, 256);
    if (!this.inRange(e.at, len)) return undefined;
    let s = '';
    for (let i = 0; i < len; i++) {
      const c = this.bytes[e.at + i];
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    s = s.trim();
    return s || undefined;
  }
}

function tiffReaderAt(bytes: Uint8Array, base: number): TiffReader | null {
  if (base + 8 > bytes.length) return null;
  const a = bytes[base];
  const b = bytes[base + 1];
  let le: boolean;
  if (a === 0x49 && b === 0x49) le = true;
  else if (a === 0x4d && b === 0x4d) le = false;
  else return null;
  const r = new TiffReader(bytes, base, le);
  const magic = r.u16(base + 2);
  // 42 = TIFF, 0x4f52 / 0x5352 = Olympus ORF, 0x55 = Panasonic RW2
  if (magic !== 42 && magic !== 0x4f52 && magic !== 0x5352 && magic !== 0x55) return null;
  return r;
}

/** "2024:05:01 13:45:10" → ms since epoch (local time). */
export function parseExifDate(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const m = /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s);
  if (!m) return undefined;
  const [y, mo, d, h, mi, se] = m.slice(1).map(Number);
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return undefined;
  const t = new Date(y, mo - 1, d, h, mi, se).getTime();
  return Number.isFinite(t) ? t : undefined;
}

function readExifFromTiff(r: TiffReader): ExifInfo {
  const info: ExifInfo = {};
  const ifd0 = r.readIfd(r.u32(r.base + 4));
  if (!ifd0) return info;
  const e0 = ifd0.entries;
  info.make = r.string(e0.get(0x010f));
  info.model = r.string(e0.get(0x0110));
  info.software = r.string(e0.get(0x0131));
  info.artist = r.string(e0.get(0x013b));
  info.copyright = r.string(e0.get(0x8298));
  info.orientation = r.number(e0.get(0x0112));
  info.dateTime = r.string(e0.get(0x0132));

  const exifPtr = r.number(e0.get(0x8769));
  if (exifPtr) {
    const ex = r.readIfd(exifPtr)?.entries;
    if (ex) {
      info.exposureTime = r.number(ex.get(0x829a));
      info.fNumber = r.number(ex.get(0x829d));
      info.iso = r.number(ex.get(0x8827));
      const original = r.string(ex.get(0x9003)) ?? r.string(ex.get(0x9004));
      if (original) info.dateTime = original;
      info.exposureBias = r.number(ex.get(0x9204));
      const flash = r.number(ex.get(0x9209));
      if (flash !== undefined) info.flash = (flash & 1) === 1;
      info.focalLength = r.number(ex.get(0x920a));
      info.focalLength35 = r.number(ex.get(0xa405));
      info.lens = r.string(ex.get(0xa434));
      info.pixelWidth = r.number(ex.get(0xa002));
      info.pixelHeight = r.number(ex.get(0xa003));
      if (!info.exposureTime) {
        const apex = r.number(ex.get(0x9201));
        if (apex !== undefined) info.exposureTime = Math.pow(2, -apex);
      }
      if (!info.fNumber) {
        const av = r.number(ex.get(0x9202));
        if (av !== undefined) info.fNumber = Math.pow(Math.SQRT2, av);
      }
    }
  }

  const gpsPtr = r.number(e0.get(0x8825));
  if (gpsPtr) {
    const g = r.readIfd(gpsPtr)?.entries;
    if (g) {
      const toDeg = (vals: number[]) => (vals.length >= 3 ? vals[0] + vals[1] / 60 + vals[2] / 3600 : undefined);
      const lat = toDeg(r.numbers(g.get(0x0002), 3));
      const lon = toDeg(r.numbers(g.get(0x0004), 3));
      if (lat !== undefined && lon !== undefined && (lat !== 0 || lon !== 0)) {
        const latRef = r.string(g.get(0x0001));
        const lonRef = r.string(g.get(0x0003));
        info.gps = { lat: latRef === 'S' ? -lat : lat, lon: lonRef === 'W' ? -lon : lon };
      }
    }
  }

  // IFD1 = thumbnail
  if (ifd0.next) {
    const t = r.readIfd(ifd0.next)?.entries;
    const off = r.number(t?.get(0x0201));
    const len = r.number(t?.get(0x0202));
    if (off && len && r.inRange(r.base + off, len)) info.thumbnail = { offset: r.base + off, length: len };
  }
  info.date = parseExifDate(info.dateTime);
  for (const key of Object.keys(info) as (keyof ExifInfo)[]) if (info[key] === undefined) delete info[key];
  return info;
}

/** Finds the EXIF APP1 segment of a JPEG and parses it. */
export function parseJpegExif(bytes: Uint8Array): ExifInfo | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    if (marker === 0xff) {
      i++;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) return null; // start of scan: no EXIF before image data
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (len < 2) return null;
    if (
      marker === 0xe1 &&
      bytes[i + 4] === 0x45 &&
      bytes[i + 5] === 0x78 &&
      bytes[i + 6] === 0x69 &&
      bytes[i + 7] === 0x66 &&
      bytes[i + 8] === 0 &&
      bytes[i + 9] === 0
    ) {
      const r = tiffReaderAt(bytes, i + 10);
      return r ? readExifFromTiff(r) : null;
    }
    i += 2 + len;
  }
  return null;
}

/** EXIF of a TIFF-based file (TIFF, DNG and most RAW formats). */
export function parseTiffExif(bytes: Uint8Array): ExifInfo | null {
  const r = tiffReaderAt(bytes, 0);
  return r ? readExifFromTiff(r) : null;
}

export interface JpegInfo {
  width: number;
  height: number;
  /** SOF marker (0xc0 baseline, 0xc1 extended, 0xc2 progressive, 0xc3 lossless, ...). */
  sof: number;
  /** Total length of the JPEG stream (when the end could be found). */
  length?: number;
}

/** Parses JPEG markers from `start`: dimensions, SOF type and (optionally) stream length. */
export function jpegInfo(bytes: Uint8Array, start = 0, findEnd = false): JpegInfo | null {
  if (start + 4 > bytes.length || bytes[start] !== 0xff || bytes[start + 1] !== 0xd8) return null;
  let i = start + 2;
  let info: JpegInfo | null = null;
  while (i + 2 <= bytes.length) {
    if (bytes[i] !== 0xff) return findEnd ? null : info;
    const marker = bytes[i + 1];
    if (marker === 0xff) {
      i++;
      continue;
    }
    if (marker === 0xd9) {
      if (info) info.length = i + 2 - start;
      return info;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    if (i + 4 > bytes.length) break;
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (len < 2) return info;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc && i + 9 <= bytes.length) {
      info = { sof: marker, height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8] };
      if (!findEnd) return info;
    }
    if (marker === 0xda) {
      // skip entropy coded data: next marker that isn't a stuffed 0xff00 or a restart marker
      let j = i + 2 + len;
      while (j + 1 < bytes.length) {
        if (bytes[j] === 0xff) {
          const m = bytes[j + 1];
          if (m !== 0 && !(m >= 0xd0 && m <= 0xd7) && m !== 0xff) break;
        }
        j++;
      }
      if (j + 1 >= bytes.length) return findEnd ? null : info;
      i = j;
      continue;
    }
    i += 2 + len;
  }
  return findEnd ? null : info;
}

export interface EmbeddedJpeg {
  offset: number;
  length: number;
  width: number;
  height: number;
}

function collectTiffJpegs(r: TiffReader, out: { offset: number; length: number }[]): void {
  const seen = new Set<number>();
  const visit = (rel: number, depth: number) => {
    if (!rel || depth > 4 || seen.has(rel) || seen.size > 64) return;
    seen.add(rel);
    const ifd = r.readIfd(rel);
    if (!ifd) return;
    const e = ifd.entries;
    const off = r.number(e.get(0x0201));
    const len = r.number(e.get(0x0202));
    if (off && len) out.push({ offset: r.base + off, length: len });
    const compression = r.number(e.get(0x0103));
    const strips = r.numbers(e.get(0x0111), 4);
    const counts = r.numbers(e.get(0x0117), 4);
    if ((compression === 6 || compression === 7 || compression === 99) && strips.length === 1 && counts.length === 1) {
      out.push({ offset: r.base + strips[0], length: counts[0] });
    }
    for (const sub of r.numbers(e.get(0x014a), 16)) visit(sub, depth + 1);
    const exifPtr = r.number(e.get(0x8769));
    if (exifPtr) visit(exifPtr, depth + 1);
    visit(ifd.next, depth + 1);
  };
  visit(r.u32(r.base + 4), 0);
}

/**
 * The largest browser-decodable JPEG embedded in a RAW/TIFF container (or null).
 * Lossless JPEG streams (raw sensor data) are ignored.
 */
export function findEmbeddedJpeg(bytes: Uint8Array, options: { scan?: boolean } = {}): EmbeddedJpeg | null {
  const candidates: { offset: number; length: number }[] = [];
  const r = tiffReaderAt(bytes, 0);
  if (r) collectTiffJpegs(r, candidates);
  // Fujifilm RAF: JPEG offset/length in the header
  if (bytes.length > 100 && String.fromCharCode(...bytes.subarray(0, 15)) === 'FUJIFILMCCD-RAW') {
    const dv = new DataView(bytes.buffer, bytes.byteOffset);
    candidates.push({ offset: dv.getUint32(84), length: dv.getUint32(88) });
  }
  let best: EmbeddedJpeg | null = null;
  const consider = (offset: number, length?: number) => {
    if (offset < 0 || offset + 4 > bytes.length) return;
    const info = jpegInfo(bytes, offset, length === undefined);
    if (!info || info.sof === 0xc3 || info.sof > 0xc2 || !info.width || !info.height) return;
    const len = length ?? info.length;
    if (!len || offset + len > bytes.length + 2) return;
    if (!best || info.width * info.height > best.width * best.height) best = { offset, length: Math.min(len, bytes.length - offset), width: info.width, height: info.height };
  };
  for (const c of candidates) consider(c.offset, c.length);
  if (!best && options.scan !== false) {
    for (let i = 0; i + 3 < bytes.length; i++) {
      if (bytes[i] === 0xff && bytes[i + 1] === 0xd8 && bytes[i + 2] === 0xff) {
        const before: EmbeddedJpeg | null = best;
        consider(i);
        const found = best as EmbeddedJpeg | null;
        if (found && found !== before) i = found.offset + found.length - 1;
      }
    }
  }
  return best;
}

/** Orientation tag of a TIFF-based file (1 when missing). */
export function tiffOrientation(bytes: Uint8Array): number {
  const r = tiffReaderAt(bytes, 0);
  const ifd0 = r?.readIfd(r.u32(r.base + 4));
  const o = r && ifd0 ? r.number(ifd0.entries.get(0x0112)) : undefined;
  return o && o >= 1 && o <= 8 ? o : 1;
}

/* ------------------------------ Image headers ------------------------------ */

export interface ImageHeader {
  format: ImageFormat;
  width: number;
  height: number;
  exif: ExifInfo | null;
}

function ascii(bytes: Uint8Array, start: number, len: number): string {
  let s = '';
  for (let i = start; i < start + len && i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

export function sniffFormat(bytes: Uint8Array, name = ''): ImageFormat {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (RAW_EXTENSIONS.includes(ext)) return 'raw';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpeg';
  if (bytes[0] === 0x89 && ascii(bytes, 1, 3) === 'PNG') return 'png';
  if (ascii(bytes, 0, 4) === 'GIF8') return 'gif';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'webp';
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return 'bmp';
  if ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 42) || (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[3] === 42)) return 'tiff';
  if (ascii(bytes, 4, 4) === 'ftyp') {
    const brand = ascii(bytes, 8, 4);
    if (brand === 'avif' || brand === 'avis') return 'avif';
    if (['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1'].includes(brand)) return 'heic';
    if (brand === 'crx ') return 'raw';
  }
  return 'unknown';
}

/** Reads format, pixel size (after EXIF orientation) and EXIF from the start of a file. */
export function readImageHeader(bytes: Uint8Array, name = ''): ImageHeader {
  const format = sniffFormat(bytes, name);
  let width = 0;
  let height = 0;
  let exif: ExifInfo | null = null;
  const be16 = (i: number) => (bytes[i] << 8) | bytes[i + 1];
  const le16 = (i: number) => bytes[i] | (bytes[i + 1] << 8);
  const be32 = (i: number) => ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0;
  const le24 = (i: number) => bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16);
  switch (format) {
    case 'jpeg': {
      exif = parseJpegExif(bytes);
      const info = jpegInfo(bytes, 0);
      if (info) {
        width = info.width;
        height = info.height;
      }
      break;
    }
    case 'png':
      width = be32(16);
      height = be32(20);
      break;
    case 'gif':
      width = le16(6);
      height = le16(8);
      break;
    case 'webp': {
      const chunk = ascii(bytes, 12, 4);
      if (chunk === 'VP8 ') {
        width = le16(26) & 0x3fff;
        height = le16(28) & 0x3fff;
      } else if (chunk === 'VP8L') {
        const b = bytes;
        width = 1 + (((b[22] & 0x3f) << 8) | b[21]);
        height = 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6));
      } else if (chunk === 'VP8X') {
        width = 1 + le24(24);
        height = 1 + le24(27);
      }
      break;
    }
    case 'bmp':
      width = Math.abs(new DataView(bytes.buffer, bytes.byteOffset).getInt32(18, true));
      height = Math.abs(new DataView(bytes.buffer, bytes.byteOffset).getInt32(22, true));
      break;
    case 'tiff':
    case 'raw': {
      exif = parseTiffExif(bytes);
      const r = tiffReaderAt(bytes, 0);
      const ifd0 = r?.readIfd(r.u32(r.base + 4));
      if (r && ifd0) {
        width = r.number(ifd0.entries.get(0x0100)) ?? 0;
        height = r.number(ifd0.entries.get(0x0101)) ?? 0;
      }
      break;
    }
    case 'avif':
    case 'heic': {
      for (let i = 0; i + 20 < Math.min(bytes.length, 1 << 20); i++) {
        if (bytes[i] === 0x69 && ascii(bytes, i, 4) === 'ispe') {
          width = be32(i + 8);
          height = be32(i + 12);
          break;
        }
      }
      break;
    }
    default:
      void be16;
  }
  const o = exif?.orientation ?? 1;
  if (o >= 5 && o <= 8 && format === 'jpeg') [width, height] = [height, width];
  return { format, width, height, exif };
}

/** "1/250 s", "2.5 s" */
export function formatShutter(seconds: number | undefined): string | undefined {
  if (!seconds || !Number.isFinite(seconds)) return undefined;
  if (seconds >= 0.5) return `${+seconds.toFixed(1)} s`;
  return `1/${Math.round(1 / seconds)} s`;
}

export function formatAperture(f: number | undefined): string | undefined {
  return f ? `f/${+f.toFixed(1)}` : undefined;
}

export function formatFocal(mm: number | undefined): string | undefined {
  return mm ? `${+mm.toFixed(0)} mm` : undefined;
}

export function cameraName(exif: ExifInfo | null | undefined): string | undefined {
  if (!exif) return undefined;
  const make = exif.make ?? '';
  const model = exif.model ?? '';
  if (!make) return model || undefined;
  return model.toLowerCase().startsWith(make.toLowerCase().split(' ')[0]) ? model : `${make} ${model}`.trim();
}
