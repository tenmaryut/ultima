/**
 * Accessibility math: WCAG 2.1 contrast, APCA (W3 0.0.98G-4g) and matrix based
 * color-vision-deficiency simulation (Machado, Oliveira & Fernandes 2009).
 * Pure functions — unit tested in a11y.test.ts.
 */
import { deltaE, hexToRgb, labToRgb, linearToSrgb, rgbToLab, srgbToLinear, toHex, type RGB } from './colormath';

/* ---------------------------------- WCAG ---------------------------------- */

export function relativeLuminance({ r, g, b }: RGB): number {
  return 0.2126 * srgbToLinear(r / 255) + 0.7152 * srgbToLinear(g / 255) + 0.0722 * srgbToLinear(b / 255);
}

export function contrastRatio(a: RGB, b: RGB): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export function contrastHex(a: string, b: string): number {
  return contrastRatio(hexToRgb(a), hexToRgb(b));
}

export interface WcagResult {
  ratio: number;
  /** AA, normal text (≥ 4.5:1). */
  aaNormal: boolean;
  /** AA, large text ≥ 18pt or 14pt bold (≥ 3:1). */
  aaLarge: boolean;
  /** AAA, normal text (≥ 7:1). */
  aaaNormal: boolean;
  /** AAA, large text (≥ 4.5:1). */
  aaaLarge: boolean;
  /** Non-text UI components and graphics (≥ 3:1, WCAG 1.4.11). */
  ui: boolean;
}

/** WCAG rounds nothing: 4.499 fails AA. */
export function wcag(fg: string, bg: string): WcagResult {
  const ratio = contrastHex(fg, bg);
  return {
    ratio,
    aaNormal: ratio >= 4.5,
    aaLarge: ratio >= 3,
    aaaNormal: ratio >= 7,
    aaaLarge: ratio >= 4.5,
    ui: ratio >= 3,
  };
}

/** "4.5:1" style label (truncated, not rounded up, so a failing ratio never reads as passing). */
export function formatRatio(ratio: number): string {
  return `${(Math.floor(ratio * 100) / 100).toFixed(2)}:1`;
}

/* ---------------------------------- APCA ---------------------------------- */

const APCA = {
  mainTRC: 2.4,
  sRco: 0.2126729,
  sGco: 0.7151522,
  sBco: 0.072175,
  normBG: 0.56,
  normTXT: 0.57,
  revTXT: 0.62,
  revBG: 0.65,
  blkThrs: 0.022,
  blkClmp: 1.414,
  scaleBoW: 1.14,
  scaleWoB: 1.14,
  loBoWoffset: 0.027,
  loWoBoffset: 0.027,
  deltaYmin: 0.0005,
  loClip: 0.1,
};

function apcaY({ r, g, b }: RGB): number {
  const f = (c: number) => Math.pow(Math.max(0, Math.min(255, c)) / 255, APCA.mainTRC);
  return APCA.sRco * f(r) + APCA.sGco * f(g) + APCA.sBco * f(b);
}

/**
 * APCA lightness contrast Lc (≈ -108 … 106). Positive = dark text on a light background,
 * negative = light text on a dark background.
 */
export function apcaContrast(text: RGB, background: RGB): number {
  let txtY = apcaY(text);
  let bgY = apcaY(background);
  txtY = txtY > APCA.blkThrs ? txtY : txtY + Math.pow(APCA.blkThrs - txtY, APCA.blkClmp);
  bgY = bgY > APCA.blkThrs ? bgY : bgY + Math.pow(APCA.blkThrs - bgY, APCA.blkClmp);
  if (Math.abs(bgY - txtY) < APCA.deltaYmin) return 0;
  if (bgY > txtY) {
    const sapc = (Math.pow(bgY, APCA.normBG) - Math.pow(txtY, APCA.normTXT)) * APCA.scaleBoW;
    return sapc < APCA.loClip ? 0 : (sapc - APCA.loBoWoffset) * 100;
  }
  const sapc = (Math.pow(bgY, APCA.revBG) - Math.pow(txtY, APCA.revTXT)) * APCA.scaleWoB;
  return sapc > -APCA.loClip ? 0 : (sapc + APCA.loWoBoffset) * 100;
}

/** English description of what an |Lc| value is good for (translate with t()). */
export function apcaUsage(lc: number): string {
  const v = Math.abs(lc);
  if (v >= 90) return 'Preferred for body text (14px+) and all uses';
  if (v >= 75) return 'Minimum for body text (18px+), good for content text';
  if (v >= 60) return 'Minimum for content text that is not body text (24px+ or 16px bold)';
  if (v >= 45) return 'Large headlines (36px+ or 24px bold) and pictograms';
  if (v >= 30) return 'Placeholder or disabled text, non-text elements';
  if (v >= 15) return 'Dividers and decorative elements only';
  return 'Not readable';
}

/* --------------------------- Color vision deficiency --------------------------- */

export type CvdType = 'protanopia' | 'deuteranopia' | 'tritanopia' | 'achromatopsia';

export const CVD_TYPES: { id: CvdType; label: string; description: string }[] = [
  { id: 'protanopia', label: 'Protanopia', description: 'No red cones (about 1% of men)' },
  { id: 'deuteranopia', label: 'Deuteranopia', description: 'No green cones (about 1% of men)' },
  { id: 'tritanopia', label: 'Tritanopia', description: 'No blue cones (rare)' },
  { id: 'achromatopsia', label: 'Achromatopsia', description: 'No color vision (very rare)' },
];

/** Machado et al. 2009, severity 1.0, applied to linear RGB. Row major 3×3. */
export const CVD_MATRICES: Record<Exclude<CvdType, 'achromatopsia'>, readonly number[]> = {
  protanopia: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deuteranopia: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
  tritanopia: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
};

/** Luminance weights used for achromatopsia (rod monochromacy). */
export const ACHROMATOPSIA_MATRIX: readonly number[] = [
  0.2126, 0.7152, 0.0722, 0.2126, 0.7152, 0.0722, 0.2126, 0.7152, 0.0722,
];

export function cvdMatrix(type: CvdType, severity = 1): number[] {
  const full = type === 'achromatopsia' ? ACHROMATOPSIA_MATRIX : CVD_MATRICES[type];
  const s = Math.max(0, Math.min(1, severity));
  const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  return full.map((v, i) => identity[i] + (v - identity[i]) * s);
}

/** Simulates how `rgb` looks with the given deficiency (severity 0–1, anomalous trichromacy below 1). */
export function simulateCvd(rgb: RGB, type: CvdType, severity = 1): RGB {
  const m = cvdMatrix(type, severity);
  const r = srgbToLinear(rgb.r / 255);
  const g = srgbToLinear(rgb.g / 255);
  const b = srgbToLinear(rgb.b / 255);
  const out = [m[0] * r + m[1] * g + m[2] * b, m[3] * r + m[4] * g + m[5] * b, m[6] * r + m[7] * g + m[8] * b];
  const [cr, cg, cb] = out.map((c) => Math.max(0, Math.min(255, linearToSrgb(Math.max(0, Math.min(1, c))) * 255)));
  return { r: cr, g: cg, b: cb };
}

export function simulateHex(hex: string, type: CvdType, severity = 1): string {
  return toHex(simulateCvd(hexToRgb(hex), type, severity));
}

/** Pairs of swatches that become hard to tell apart (ΔE76 below `threshold`) under a deficiency. */
export function cvdConflicts(hexes: string[], type: CvdType, severity = 1, threshold = 12): { a: number; b: number; delta: number }[] {
  const sim = hexes.map((h) => rgbToLab(simulateCvd(hexToRgb(h), type, severity)));
  const orig = hexes.map((h) => rgbToLab(hexToRgb(h)));
  const out: { a: number; b: number; delta: number }[] = [];
  for (let i = 0; i < hexes.length; i++) {
    for (let j = i + 1; j < hexes.length; j++) {
      const d = deltaE(sim[i], sim[j]);
      // only report pairs that were distinguishable with normal vision
      if (d < threshold && deltaE(orig[i], orig[j]) >= threshold) out.push({ a: i, b: j, delta: d });
    }
  }
  return out;
}

/* ------------------------------- Contrast fixes ------------------------------- */

/**
 * Closest color to `fg` (same Lab hue/chroma direction, different lightness) that reaches
 * `target` contrast against `bg`. Returns null when even black/white can't reach it.
 */
export function suggestContrastFix(fg: string, bg: string, target: number): string | null {
  if (contrastHex(fg, bg) >= target) return fg;
  const bgRgb = hexToRgb(bg);
  const lab = rgbToLab(hexToRgb(fg));
  const tryL = (l: number): string | null => {
    for (const chroma of [1, 0.85, 0.7, 0.5, 0.25, 0]) {
      const hex = toHex(labToRgb({ l, a: lab.a * chroma, b: lab.b * chroma }));
      if (contrastRatio(hexToRgb(hex), bgRgb) >= target) return hex;
    }
    return null;
  };
  let darker: { hex: string; d: number } | null = null;
  for (let l = lab.l; l >= 0; l -= 0.5) {
    const hex = tryL(l);
    if (hex) {
      darker = { hex, d: lab.l - l };
      break;
    }
  }
  let lighter: { hex: string; d: number } | null = null;
  for (let l = lab.l; l <= 100; l += 0.5) {
    const hex = tryL(l);
    if (hex) {
      lighter = { hex, d: l - lab.l };
      break;
    }
  }
  if (!darker && !lighter) return null;
  if (!darker) return lighter!.hex;
  if (!lighter) return darker.hex;
  return darker.d <= lighter.d ? darker.hex : lighter.hex;
}

export interface PairCheck {
  text: number;
  background: number;
  ratio: number;
  pass: boolean;
}

/** Checks text/background pairs (indexes into `hexes`) against a contrast target. */
export function checkPairs(hexes: string[], pairs: { text: number; background: number }[], target = 4.5): PairCheck[] {
  return pairs
    .filter((p) => hexes[p.text] && hexes[p.background] && p.text !== p.background)
    .map((p) => {
      const ratio = contrastHex(hexes[p.text], hexes[p.background]);
      return { ...p, ratio, pass: ratio >= target };
    });
}

/**
 * Default text pairs for a palette: every color against the lightest and the darkest
 * color (whichever gives more contrast), as a designer would use them.
 */
export function defaultTextPairs(hexes: string[]): { text: number; background: number }[] {
  if (hexes.length < 2) return [];
  const lum = hexes.map((h) => relativeLuminance(hexToRgb(h)));
  const light = lum.indexOf(Math.max(...lum));
  const dark = lum.indexOf(Math.min(...lum));
  const out: { text: number; background: number }[] = [];
  hexes.forEach((h, i) => {
    if (i === light || i === dark) return;
    const vsLight = contrastHex(h, hexes[light]);
    const vsDark = contrastHex(h, hexes[dark]);
    out.push({ text: i, background: vsLight >= vsDark ? light : dark });
  });
  if (light !== dark) out.push({ text: dark, background: light });
  return out;
}

/** Locally nudges failing text colors (lightness only) until every pair passes. */
export function fixPairs(hexes: string[], pairs: { text: number; background: number }[], target = 4.5, locked: boolean[] = []): string[] {
  const out = [...hexes];
  for (const p of pairs) {
    if (!out[p.text] || !out[p.background] || contrastHex(out[p.text], out[p.background]) >= target) continue;
    if (!locked[p.text]) {
      const fixed = suggestContrastFix(out[p.text], out[p.background], target);
      if (fixed) {
        out[p.text] = fixed;
        continue;
      }
    }
    if (!locked[p.background]) {
      const fixed = suggestContrastFix(out[p.background], out[p.text], target);
      if (fixed) out[p.background] = fixed;
    }
  }
  return out;
}
