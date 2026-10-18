import { parseColor } from '../../core/utils/color';
import type { CaptionStyle, TitleStyle } from './types';
import { titleAnimState } from './fx';

/* Canvas text drawing for titles and captions (shared by preview and export). */

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui']);

export function fontFamily(name: string): string {
  const clean = name.replace(/["';{}<>\\]/g, '').trim() || 'Inter';
  return GENERIC.has(clean) ? clean : `"${clean}", "Inter", system-ui, sans-serif`;
}

export function fontString(weight: number, italic: boolean, size: number, family: string): string {
  return `${italic ? 'italic ' : ''}${Math.round(weight)} ${Math.max(1, size)}px ${fontFamily(family)}`;
}

/** Word-wraps text (respecting explicit line breaks) to fit `maxWidth` with the current font. */
export function wrapText(ctx: Ctx, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      out.push('');
      continue;
    }
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (!line || ctx.measureText(candidate).width <= maxWidth) {
        line = candidate;
        // break overlong single words by characters
        while (ctx.measureText(line).width > maxWidth && line.length > 1) {
          let cut = line.length - 1;
          while (cut > 1 && ctx.measureText(line.slice(0, cut)).width > maxWidth) cut--;
          out.push(line.slice(0, cut));
          line = line.slice(cut);
        }
      } else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

interface Line {
  text: string;
  font: string;
  size: number;
  width: number;
  height: number;
}

/** Draws an animated title in frame coordinates (W × H). */
export function drawTitle(ctx: Ctx, style: TitleStyle, local: number, duration: number, W: number, H: number): void {
  const anim = titleAnimState(style.animation, local, duration, style.animDuration);
  if (anim.alpha <= 0.002 || (!style.text && !style.subtitle)) return;
  const mainFont = fontString(style.weight, style.italic, style.size, style.font);
  const subSize = Math.max(1, Math.round(style.size * 0.55));
  const subFont = fontString(Math.max(100, style.weight - 200), style.italic, subSize, style.font);
  const maxW = W * 0.92;
  const lines: Line[] = [];
  ctx.save();
  ctx.font = mainFont;
  for (const text of style.text ? wrapText(ctx, style.text, maxW) : []) {
    lines.push({ text, font: mainFont, size: style.size, width: ctx.measureText(text).width, height: style.size * 1.18 });
  }
  if (style.subtitle) {
    ctx.font = subFont;
    for (const text of wrapText(ctx, style.subtitle, maxW)) {
      lines.push({ text, font: subFont, size: subSize, width: ctx.measureText(text).width, height: subSize * 1.3 });
    }
  }
  // typewriter: reveal characters progressively
  if (anim.reveal < 1) {
    let budget = Math.round(lines.reduce((n, l) => n + l.text.length, 0) * anim.reveal);
    for (const l of lines) {
      const keep = Math.max(0, Math.min(l.text.length, budget));
      budget -= l.text.length;
      l.text = l.text.slice(0, keep);
    }
  }
  const blockW = Math.max(1, ...lines.map((l) => l.width));
  const blockH = lines.reduce((n, l) => n + l.height, 0);
  const ax = style.x * W;
  const ay = style.y * H + anim.dy * H;
  const left = style.align === 'left' ? ax : style.align === 'right' ? ax - blockW : ax - blockW / 2;
  const top = ay - blockH / 2;

  ctx.globalAlpha *= anim.alpha;
  if (anim.scale !== 1) {
    ctx.translate(ax, ay);
    ctx.scale(anim.scale, anim.scale);
    ctx.translate(-ax, -ay);
  }
  if (style.box) {
    const padX = style.size * 0.38;
    const padY = style.size * 0.2;
    ctx.fillStyle = style.boxColor;
    roundRect(ctx, left - padX, top - padY, blockW + padX * 2, blockH + padY * 2, style.size * 0.14);
    ctx.fill();
  }
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.lineJoin = 'round';
  let y = top;
  for (const l of lines) {
    const cy = y + l.height / 2;
    const x = style.align === 'left' ? left : style.align === 'right' ? left + blockW - l.width : left + (blockW - l.width) / 2;
    ctx.font = l.font;
    const outline = style.outlineWidth * (l.size / style.size);
    const depth = (style.extrude ?? 0) * (l.size / style.size);
    if (depth > 0.5) {
      // 3D letters: copies stacked down and to the right behind the face, darker the deeper
      const steps = Math.min(80, Math.ceil(depth));
      const front = shadeColor(style.extrudeColor ?? style.color, style.extrudeColor ? 0 : 0.45);
      const back = shadeColor(style.extrudeColor ?? style.color, style.extrudeColor ? 0.35 : 0.75);
      for (let k = steps; k >= 1; k--) {
        const d = (depth * k) / steps;
        ctx.fillStyle = mixColor(front, back, k / steps);
        ctx.fillText(l.text, x + d * 0.45, cy + d * 0.9);
      }
    }
    if (outline > 0) {
      ctx.lineWidth = outline * 2;
      ctx.strokeStyle = style.outlineColor;
      ctx.strokeText(l.text, x, cy);
    }
    if (style.shadow && !style.box) {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
      ctx.shadowBlur = l.size * 0.14;
      ctx.shadowOffsetY = l.size * 0.05;
    }
    ctx.fillStyle = style.color;
    ctx.fillText(l.text, x, cy);
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    y += l.height;
  }
  ctx.restore();
}

/** A color made darker by `k` (0-1), as an rgb triple. */
function shadeColor(c: string, k: number): [number, number, number] {
  const p = parseColor(c) ?? { r: 255, g: 255, b: 255, a: 1 };
  return [p.r * (1 - k), p.g * (1 - k), p.b * (1 - k)];
}

function mixColor(a: [number, number, number], b: [number, number, number], k: number): string {
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * k)}, ${Math.round(a[1] + (b[1] - a[1]) * k)}, ${Math.round(a[2] + (b[2] - a[2]) * k)})`;
}

/** Draws a caption with the project caption style (per-line background boxes, like TV subtitles). */
export function drawCaption(ctx: Ctx, text: string, style: CaptionStyle, W: number, H: number): void {
  if (!text.trim()) return;
  ctx.save();
  ctx.font = fontString(style.weight, false, style.size, style.font);
  const lines = wrapText(ctx, text.trim(), W * style.maxWidth);
  const lh = style.size * 1.32;
  const blockH = lines.length * lh;
  const top = style.position === 'top' ? H * style.margin : H * (1 - style.margin) - blockH;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.lineJoin = 'round';
  lines.forEach((line, i) => {
    const w = ctx.measureText(line).width;
    const x = W / 2 - w / 2;
    const cy = top + i * lh + lh / 2;
    if (style.box && line) {
      const padX = style.size * 0.3;
      ctx.fillStyle = style.boxColor;
      ctx.fillRect(x - padX, cy - lh / 2, w + padX * 2, lh);
    }
    if (style.outlineWidth > 0) {
      ctx.lineWidth = style.outlineWidth * 2;
      ctx.strokeStyle = style.outlineColor;
      ctx.strokeText(line, x, cy);
    }
    ctx.fillStyle = style.color;
    ctx.fillText(line, x, cy);
  });
  ctx.restore();
}

let measureCtx: CanvasRenderingContext2D | null = null;

/** Unanimated bounding box of a title's text block (box padding included) in frame coordinates. */
export function titleBox(style: TitleStyle, W: number, H: number): { x: number; y: number; w: number; h: number } {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  const ctx = measureCtx!;
  const maxW = W * 0.92;
  let blockW = 1;
  let blockH = 0;
  ctx.font = fontString(style.weight, style.italic, style.size, style.font);
  for (const line of style.text ? wrapText(ctx, style.text, maxW) : []) {
    blockW = Math.max(blockW, ctx.measureText(line).width);
    blockH += style.size * 1.18;
  }
  if (style.subtitle) {
    const subSize = Math.max(1, Math.round(style.size * 0.55));
    ctx.font = fontString(Math.max(100, style.weight - 200), style.italic, subSize, style.font);
    for (const line of wrapText(ctx, style.subtitle, maxW)) {
      blockW = Math.max(blockW, ctx.measureText(line).width);
      blockH += subSize * 1.3;
    }
  }
  const padX = style.box ? style.size * 0.38 : style.outlineWidth;
  const padY = style.box ? style.size * 0.2 : style.outlineWidth;
  const ax = style.x * W;
  const left = style.align === 'left' ? ax : style.align === 'right' ? ax - blockW : ax - blockW / 2;
  return { x: left - padX, y: style.y * H - blockH / 2 - padY, w: blockW + padX * 2, h: blockH + padY * 2 };
}
