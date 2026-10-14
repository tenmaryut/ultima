/**
 * Tool palette definition and tool switching (some tools need a file or a signature first).
 */
import {
  ArrowUpRight,
  CalendarDays,
  Circle,
  Eraser,
  EyeOff,
  Hand,
  Highlighter,
  ImagePlus,
  Minus,
  MousePointer2,
  Pencil,
  Signature,
  Square,
  Stamp,
  StickyNote,
  Strikethrough,
  Type,
  Underline,
  type LucideIcon,
} from 'lucide-react';
import { t } from '../../core/i18n';
import { pickFiles } from '../../core/platform';
import { blobToBase64 } from '../../core/utils/base64';
import { canvasToBlob, createCanvas, get2d } from '../../core/utils/image';
import { toast } from '../../components/ui';
import { jpegOrientation } from './imagepdf';
import { usePdfUi, type PendingPlacement } from './store';
import type { ToolId } from './types';

export interface ToolDef {
  id: ToolId;
  icon: LucideIcon;
  label: string;
  key?: string;
  hint: string;
}

export const TOOL_GROUPS: ToolDef[][] = [
  [
    { id: 'select', icon: MousePointer2, label: 'Select', key: 'V', hint: 'Select text or objects; drag objects to move them' },
    { id: 'hand', icon: Hand, label: 'Hand', key: 'H', hint: 'Drag to scroll (or hold Space)' },
  ],
  [
    { id: 'text', icon: Type, label: 'Add text', key: 'T', hint: 'Click to type, or drag to set the width' },
    { id: 'ink', icon: Pencil, label: 'Draw', key: 'D', hint: 'Draw freehand' },
    { id: 'highlight', icon: Highlighter, label: 'Highlight', key: 'Y', hint: 'Select text to highlight it, or drag over an area' },
    { id: 'underline', icon: Underline, label: 'Underline', key: 'U', hint: 'Select text to underline it' },
    { id: 'strike', icon: Strikethrough, label: 'Strikethrough', key: 'K', hint: 'Select text to strike it through' },
  ],
  [
    { id: 'rect', icon: Square, label: 'Rectangle', key: 'R', hint: 'Drag to draw (Shift for a square)' },
    { id: 'ellipse', icon: Circle, label: 'Ellipse', key: 'O', hint: 'Drag to draw (Shift for a circle)' },
    { id: 'line', icon: Minus, label: 'Line', key: 'L', hint: 'Drag to draw (Shift for 45° steps)' },
    { id: 'arrow', icon: ArrowUpRight, label: 'Arrow', key: 'A', hint: 'Drag to draw (Shift for 45° steps)' },
  ],
  [
    { id: 'image', icon: ImagePlus, label: 'Image', key: 'I', hint: 'Click on the page to place the image' },
    { id: 'stamp', icon: Stamp, label: 'Stamp', key: 'S', hint: 'Click to place the stamp' },
    { id: 'signature', icon: Signature, label: 'Sign', key: 'G', hint: 'Click on the page to place your signature' },
    { id: 'date', icon: CalendarDays, label: 'Date', hint: "Click to stamp today's date" },
    { id: 'note', icon: StickyNote, label: 'Note', key: 'N', hint: 'Click to add a comment' },
  ],
  [
    { id: 'whiteout', icon: Eraser, label: 'Whiteout', key: 'W', hint: 'Drag to cover content with white' },
    { id: 'redact', icon: EyeOff, label: 'Redact', key: 'X', hint: 'Drag to mark areas, then Apply redactions' },
  ],
];

export const ALL_TOOLS = TOOL_GROUPS.flat();

export function toolDef(id: ToolId): ToolDef | undefined {
  return ALL_TOOLS.find((d) => d.id === id);
}

/** Reads an image as a PNG/JPEG data URL with its natural size in points (EXIF orientation applied). */
export async function imageToPlacement(blob: Blob, kind: PendingPlacement['kind'], maxPx = 4000): Promise<PendingPlacement> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  try {
    const fits = Math.max(bitmap.width, bitmap.height) <= maxPx;
    if (fits && (isPng || (isJpeg && jpegOrientation(bytes) === 1))) {
      const mime = isPng ? 'image/png' : 'image/jpeg';
      return { kind, src: `data:${mime};base64,${await blobToBase64(blob)}`, width: (bitmap.width * 72) / 96, height: (bitmap.height * 72) / 96 };
    }
    const scale = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height));
    const canvas = createCanvas(bitmap.width * scale, bitmap.height * scale);
    get2d(canvas).drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const out = await canvasToBlob(canvas, isJpeg ? 'image/jpeg' : 'image/png', 0.92);
    const result: PendingPlacement = {
      kind,
      src: `data:${out.type || 'image/png'};base64,${await blobToBase64(out)}`,
      width: (canvas.width * 72) / 96,
      height: (canvas.height * 72) / 96,
    };
    canvas.width = canvas.height = 0;
    return result;
  } finally {
    bitmap.close();
  }
}

export async function selectTool(id: ToolId): Promise<void> {
  const ui = usePdfUi.getState();
  if (id === 'signature') {
    ui.set({ dialog: 'signature' });
    return;
  }
  if (id === 'image') {
    const [file] = await pickFiles({ accept: 'image/*' });
    if (!file) return;
    try {
      const pending = await imageToPlacement(file, 'image');
      usePdfUi.getState().set({ tool: 'image', pending, editing: null, mode: 'view' });
      toast.info(t('Click on a page to place the image'));
    } catch {
      toast.error(t('Could not read the image'));
    }
    return;
  }
  ui.set({ tool: id, pending: null, editing: null, mode: 'view' });
}
