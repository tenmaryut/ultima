/**
 * AI integration (pure parts): the assistant instructions, parameter-name resolution and
 * validation of every action / JSON answer an AI returns. Nothing here trusts the AI:
 * unknown fields are dropped and every number is clamped to its documented range.
 */
import {
  BANDS,
  GROUPS,
  PARAMS,
  SECTION_GROUPS,
  clampParam,
  sanitizeAspect,
  sanitizeCurve,
  type CurveChannel,
  type CurvePoint,
  type GroupId,
  type NumericKey,
  type PartialSettings,
  type SectionId,
} from './params';
import { findPreset, type Preset } from './presets';
import { LABELS, type ColorLabel, type Flag } from './types';

export interface AIActionInput {
  type: string;
  [key: string]: unknown;
}

export type AIOp =
  | { type: 'set'; params: PartialSettings }
  | { type: 'adjust'; params: Partial<Record<NumericKey, number>> }
  | { type: 'curve'; channel: CurveChannel; points: CurvePoint[] }
  | { type: 'preset'; preset: Preset }
  | { type: 'autoTone' }
  | { type: 'autoWhiteBalance' }
  | { type: 'crop'; aspect?: string; straighten?: number; rect?: { x: number; y: number; w: number; h: number } }
  | { type: 'rotate'; direction: 1 | -1 }
  | { type: 'flip'; axis: 'h' | 'v' }
  | { type: 'reset'; groups: GroupId[] }
  | { type: 'rate'; rating?: number; flag?: Flag; label?: ColorLabel | null };

export interface ValidatedOp {
  op: AIOp;
  /** Apply to every selected photo instead of only the current one. */
  selected: boolean;
}

/* ----------------------------- Parameter names ----------------------------- */

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

const ALIASES: Record<string, NumericKey | 'treatment'> = (() => {
  const map: Record<string, NumericKey | 'treatment'> = {};
  for (const key of Object.keys(PARAMS) as NumericKey[]) map[norm(key)] = key;
  const add = (names: string[], key: NumericKey | 'treatment') => names.forEach((n) => (map[norm(n)] = key));
  add(['temperature', 'wbTemp', 'whiteBalanceTemp', 'warmth', 'colorTemperature'], 'temp');
  add(['wbTint', 'whiteBalanceTint'], 'tint');
  add(['ev', 'brightness', 'exposure2012'], 'exposure');
  add(['highlight', 'highlightRecovery'], 'highlights');
  add(['shadow', 'fillLight'], 'shadows');
  add(['white', 'whitePoint'], 'whites');
  add(['black', 'blackPoint'], 'blacks');
  add(['haze', 'dehazeAmount'], 'dehaze');
  add(['sharpening', 'sharpness', 'sharpen'], 'sharpenAmount');
  add(['noiseReduction', 'luminanceNoise', 'luminanceNoiseReduction', 'denoise', 'nr'], 'nrLuminance');
  add(['colorNoise', 'colorNoiseReduction', 'chromaNoise'], 'nrColor');
  add(['vignette', 'vignetting', 'postCropVignette'], 'vignetteAmount');
  add(['grain'], 'grainAmount');
  add(['angle', 'rotation', 'straightenAngle', 'level'], 'straighten');
  add(['treatment', 'blackAndWhite', 'monochrome', 'bw', 'colorMode'], 'treatment');
  for (const band of BANDS) {
    for (const [prefix, names] of [
      ['hue', ['hue']],
      ['sat', ['sat', 'saturation']],
      ['lum', ['lum', 'luminance', 'lightness', 'bwMix', 'grayMix']],
    ] as const) {
      for (const n of names) add([`${n}${band}`, `${band}${n}`, `${band}_${n}`], `${prefix}${band}` as NumericKey);
    }
  }
  const ranges = { Shadow: ['shadow', 'shadows'], Mid: ['mid', 'mids', 'midtone', 'midtones'], High: ['high', 'highlight', 'highlights'], Global: ['global', 'overall'] };
  for (const [range, names] of Object.entries(ranges)) {
    for (const n of names) {
      add([`grade${n}Hue`, `${n}Hue`, `colorGrade${n}Hue`, `${n}GradeHue`], `grade${range}Hue` as NumericKey);
      add([`grade${n}Sat`, `${n}Sat`, `${n}Saturation`, `grade${n}Saturation`, `colorGrade${n}Sat`], `grade${range}Sat` as NumericKey);
      add([`grade${n}Lum`, `${n}Lum`, `${n}Luminance`, `grade${n}Luminance`], `grade${range}Lum` as NumericKey);
    }
  }
  add(['blending', 'gradeBlend'], 'gradeBlending');
  add(['balance', 'gradingBalance'], 'gradeBalance');
  return map;
})();

/** Maps a parameter name the AI used to our key (null when unknown). Crop rect keys are not exposed. */
export function resolveParamName(name: string): NumericKey | 'treatment' | null {
  const key = ALIASES[norm(name)];
  if (!key) return null;
  if (key === 'cropX' || key === 'cropY' || key === 'cropW' || key === 'cropH' || key === 'rotate') return null;
  return key;
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v.trim().replace(/^\+/, '')))) return Number(v.trim().replace(/^\+/, ''));
  return null;
}

function parseTreatment(v: unknown): 'color' | 'bw' | null {
  if (v === true) return 'bw';
  if (v === false) return 'color';
  if (typeof v !== 'string') return null;
  const n = norm(v);
  if (['bw', 'blackandwhite', 'monochrome', 'mono', 'grayscale', 'greyscale'].includes(n)) return 'bw';
  if (['color', 'colour'].includes(n)) return 'color';
  return null;
}

/** Absolute parameter values (clamped). Unknown names are reported in `ignored`. */
export function parseParams(input: unknown, ignored: string[] = []): PartialSettings {
  const out: Record<string, unknown> = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out as PartialSettings;
  for (const [name, value] of Object.entries(input as Record<string, unknown>)) {
    const key = resolveParamName(name);
    if (!key) {
      ignored.push(name);
      continue;
    }
    if (key === 'treatment') {
      const t = parseTreatment(value);
      if (t) out.treatment = t;
      continue;
    }
    const n = toNumber(value);
    if (n === null) {
      ignored.push(name);
      continue;
    }
    out[key] = clampParam(key, n);
  }
  return out as PartialSettings;
}

/** Relative changes (deltas, not clamped here — clamped when added to the current value). */
export function parseDeltas(input: unknown, ignored: string[] = []): Partial<Record<NumericKey, number>> {
  const out: Partial<Record<NumericKey, number>> = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  for (const [name, value] of Object.entries(input as Record<string, unknown>)) {
    const key = resolveParamName(name);
    const n = toNumber(value);
    if (!key || key === 'treatment' || n === null) {
      ignored.push(name);
      continue;
    }
    const range = PARAMS[key].max - PARAMS[key].min;
    out[key] = Math.max(-range, Math.min(range, n));
  }
  return out;
}

/** AI curve points use 0..255 (0..1 also accepted). */
export function parseCurvePoints(input: unknown): CurvePoint[] | null {
  if (!Array.isArray(input) || input.length < 2) return null;
  const raw: [number, number][] = [];
  for (const p of input) {
    const x = toNumber(Array.isArray(p) ? p[0] : (p as { x?: unknown })?.x);
    const y = toNumber(Array.isArray(p) ? p[1] : (p as { y?: unknown })?.y);
    if (x === null || y === null) continue;
    raw.push([x, y]);
  }
  if (raw.length < 2) return null;
  const scale = raw.some(([x, y]) => x > 1 || y > 1) ? 255 : 1;
  return sanitizeCurve(raw.map(([x, y]) => [x / scale, y / scale]));
}

function parseChannel(v: unknown): CurveChannel {
  const n = typeof v === 'string' ? norm(v) : '';
  if (n === 'red' || n === 'r') return 'red';
  if (n === 'green' || n === 'g') return 'green';
  if (n === 'blue' || n === 'b') return 'blue';
  return 'rgb';
}

const SECTION_ALIASES: Record<string, SectionId | 'all'> = {
  all: 'all',
  everything: 'all',
  basic: 'basic',
  tone: 'basic',
  curve: 'curve',
  tonecurve: 'curve',
  curves: 'curve',
  hsl: 'hsl',
  color: 'hsl',
  colormixer: 'hsl',
  grading: 'grading',
  colorgrading: 'grading',
  splittoning: 'grading',
  detail: 'detail',
  sharpening: 'detail',
  noisereduction: 'detail',
  effects: 'effects',
  vignette: 'effects',
  grain: 'effects',
  transform: 'transform',
  crop: 'transform',
  geometry: 'transform',
};

/** Validates assistant actions. Unknown types are skipped (listed in `ignored`). */
export function validateActions(actions: AIActionInput[], presets?: Preset[]): { ops: ValidatedOp[]; ignored: string[] } {
  const ops: ValidatedOp[] = [];
  const ignored: string[] = [];
  for (const a of actions.slice(0, 50)) {
    if (!a || typeof a !== 'object' || typeof a.type !== 'string') continue;
    const selected = a.target === 'selected' || a.target === 'all';
    const push = (op: AIOp) => ops.push({ op, selected });
    switch (norm(a.type)) {
      case 'set': {
        const params = parseParams(a.params ?? a.settings, ignored);
        if (Object.keys(params).length) push({ type: 'set', params });
        break;
      }
      case 'adjust':
      case 'change':
      case 'delta': {
        const params = parseDeltas(a.params ?? a.settings, ignored);
        if (Object.keys(params).length) push({ type: 'adjust', params });
        break;
      }
      case 'curve':
      case 'tonecurve': {
        const points = parseCurvePoints(a.points);
        if (points) push({ type: 'curve', channel: parseChannel(a.channel), points });
        else ignored.push('curve');
        break;
      }
      case 'preset': {
        const preset = typeof a.name === 'string' ? findPreset(a.name, presets) : undefined;
        if (preset) push({ type: 'preset', preset });
        else ignored.push(`preset ${String(a.name)}`);
        break;
      }
      case 'autotone':
      case 'auto':
        push({ type: 'autoTone' });
        break;
      case 'autowhitebalance':
      case 'autowb':
        push({ type: 'autoWhiteBalance' });
        break;
      case 'crop': {
        const op: Extract<AIOp, { type: 'crop' }> = { type: 'crop' };
        if (typeof a.aspect === 'string') op.aspect = sanitizeAspect(a.aspect);
        const st = toNumber(a.straighten ?? a.angle);
        if (st !== null) op.straighten = clampParam('straighten', st);
        const rect = a.rect as Record<string, unknown> | undefined;
        if (rect && typeof rect === 'object') {
          const [x, y, w, h] = [rect.x, rect.y, rect.w ?? rect.width, rect.h ?? rect.height].map(toNumber);
          if (x !== null && y !== null && w !== null && h !== null && w > 0.01 && h > 0.01) {
            const cw = Math.min(1, w);
            const ch = Math.min(1, h);
            op.rect = { x: Math.max(0, Math.min(1 - cw, x)), y: Math.max(0, Math.min(1 - ch, y)), w: cw, h: ch };
          }
        }
        if (op.aspect || op.straighten !== undefined || op.rect) push(op);
        break;
      }
      case 'rotate': {
        const d = typeof a.direction === 'string' ? norm(a.direction) : toNumber(a.degrees) ?? 90;
        const dir: 1 | -1 = d === 'left' || d === 'ccw' || d === 'counterclockwise' || (typeof d === 'number' && d < 0) ? -1 : 1;
        push({ type: 'rotate', direction: dir });
        break;
      }
      case 'flip':
        push({ type: 'flip', axis: typeof a.axis === 'string' && norm(a.axis).startsWith('v') ? 'v' : 'h' });
        break;
      case 'reset': {
        const section = SECTION_ALIASES[norm(String(a.section ?? 'all'))] ?? 'all';
        push({ type: 'reset', groups: section === 'all' ? GROUPS.map((g) => g.id) : SECTION_GROUPS[section] });
        break;
      }
      case 'rate':
      case 'rating':
      case 'flag':
      case 'label': {
        const op: Extract<AIOp, { type: 'rate' }> = { type: 'rate' };
        const r = toNumber(a.rating ?? a.stars);
        if (r !== null) op.rating = Math.max(0, Math.min(5, Math.round(r)));
        if (typeof a.flag === 'string') {
          const f = norm(a.flag);
          op.flag = f === 'pick' || f === 'picked' ? 'pick' : f === 'reject' || f === 'rejected' ? 'reject' : null;
        }
        if (typeof a.label === 'string') op.label = LABELS.includes(norm(a.label) as ColorLabel) ? (norm(a.label) as ColorLabel) : null;
        if (op.rating !== undefined || op.flag !== undefined || op.label !== undefined) push(op);
        break;
      }
      default:
        ignored.push(a.type);
    }
  }
  return { ops, ignored };
}

/* ------------------------------ Instructions ------------------------------ */

function paramLine(keys: NumericKey[], note = ''): string {
  return keys
    .map((k) => {
      const d = PARAMS[k];
      return `${k} (${d.min}..${d.max}${d.unit ? ` ${d.unit}` : ''}, default ${d.def})`;
    })
    .join(', ') + (note ? ` — ${note}` : '');
}

export function developInstructions(presetNames: string[]): string {
  const bandKeys = (prefix: string) => BANDS.map((b) => `${prefix}${b}`).join('/');
  return `You edit photos in a Lightroom-like non-destructive developer. Every edit is a parameter value; the original pixels are never changed.

PARAMETERS (absolute values; 0 = no change unless a default is given):
- White balance: ${paramLine(['temp', 'tint'], 'temp + = warmer/yellow, − = cooler/blue; tint + = magenta, − = green. 0 = as shot.')}
- Tone: ${paramLine(['exposure'], 'exposure in stops (EV), decimals allowed')}; ${paramLine(['contrast', 'highlights', 'shadows', 'whites', 'blacks'])}. Highlights − recovers bright areas, shadows + lifts dark areas, whites/blacks move the end points.
- Presence: ${paramLine(['texture', 'clarity', 'dehaze', 'vibrance', 'saturation'])}. Negative texture/clarity soften (skin), vibrance boosts muted colors and protects skin.
- Treatment: "treatment": "color" | "bw" (black & white).
- HSL / Color mixer (each -100..100): ${bandKeys('hue')}, ${bandKeys('sat')}, ${bandKeys('lum')}. Bands: ${BANDS.join(', ')}. In black & white, lum<Band> is the gray mix (e.g. lumBlue -40 darkens skies).
- Color grading: gradeShadowHue/gradeMidHue/gradeHighHue/gradeGlobalHue (0..360 degrees: 0 red, 30 orange, 60 yellow, 120 green, 180 cyan, 220 blue, 280 purple), gradeShadowSat/gradeMidSat/gradeHighSat/gradeGlobalSat (0..100, keep under ~40 for subtle looks), gradeShadowLum/gradeMidLum/gradeHighLum/gradeGlobalLum (-100..100), ${paramLine(['gradeBlending', 'gradeBalance'])}.
- Detail: ${paramLine(['sharpenAmount', 'sharpenRadius', 'sharpenDetail', 'sharpenMasking', 'nrLuminance', 'nrDetail', 'nrColor'])}.
- Effects: ${paramLine(['vignetteAmount'], 'negative darkens corners')}; ${paramLine(['vignetteMidpoint', 'vignetteRoundness', 'vignetteFeather', 'grainAmount', 'grainSize', 'grainRoughness'])}.
- Geometry: ${paramLine(['straighten'], 'degrees, + rotates clockwise')}.

ACTIONS (all actions of one reply are applied together as one undo step):
1. {"type":"set","params":{"exposure":0.35,"contrast":15,"treatment":"color"}} — set absolute values (only the listed parameters change).
2. {"type":"adjust","params":{"exposure":0.3,"temp":-10}} — add to the current values (relative change; good for "a bit brighter").
3. {"type":"curve","channel":"rgb"|"red"|"green"|"blue","points":[[0,0],[64,52],[192,206],[255,255]]} — tone curve, x/y 0..255, 2..16 points sorted by x. [[0,20],...] lifts blacks (matte look).
4. {"type":"preset","name":"<preset name>"} — available presets: ${presetNames.join(', ')}.
5. {"type":"autoTone"} — automatic exposure/contrast/whites/blacks from the histogram.
6. {"type":"autoWhiteBalance"} — neutralize the color cast.
7. {"type":"crop","aspect":"original"|"free"|"1:1"|"4:5"|"2:3"|"3:2"|"16:9"|"9:16"|"<w>:<h>","straighten":-1.5,"rect":{"x":0.1,"y":0.05,"w":0.8,"h":0.9}} — all fields optional. aspect alone makes the largest centered crop of that ratio; rect (normalized 0..1 of the rotated frame) sets an exact crop; straighten in degrees (-45..45).
8. {"type":"rotate","direction":"left"|"right"} (90°) and {"type":"flip","axis":"horizontal"|"vertical"}.
9. {"type":"reset","section":"all"|"basic"|"curve"|"hsl"|"grading"|"detail"|"effects"|"transform"}.
10. {"type":"rate","rating":0-5,"flag":"pick"|"reject"|"none","label":"red"|"yellow"|"green"|"blue"|"purple"|"none"} — library metadata.
Add "target":"selected" to any action to apply it to all selected photos instead of only the current photo.

GUIDELINES: Look at the snapshot and the histogram summary. Prefer moderate values (most edits stay within ±40; exposure within ±1.5) unless the user asks for something extreme. Combine several parameters for a look (e.g. warm film: temp +15, curve lifting blacks, gradeShadowHue 30 sat 12, grain 20). Never invent parameter names.

EXAMPLES
User: "brighten it a little and make it warmer" → {"message":"Brightened by a third of a stop and warmed it up.","actions":[{"type":"adjust","params":{"exposure":0.33,"temp":12}}]}
User: "moody black and white, square" → {"message":"Converted to a contrasty black & white with a square crop.","actions":[{"type":"set","params":{"treatment":"bw","contrast":35,"highlights":-25,"shadows":-10,"clarity":20,"lumBlue":-30}},{"type":"crop","aspect":"1:1"},{"type":"set","params":{"vignetteAmount":-25}}]}`;
}

/* ------------------------- Auto edit / look answers ------------------------ */

/**
 * Settings from an AI "auto edit" / "describe a look" answer:
 * {"settings":{...}, "curve":{"rgb":[[x,y],...]}, "message":"..."} — geometry is ignored.
 */
export function parseLookAnswer(data: unknown): { settings: PartialSettings; message: string; ignored: string[] } {
  const ignored: string[] = [];
  if (!data || typeof data !== 'object') return { settings: {}, message: '', ignored };
  const d = data as Record<string, unknown>;
  const source = (d.settings && typeof d.settings === 'object' ? d.settings : d.params && typeof d.params === 'object' ? d.params : d) as Record<string, unknown>;
  const settings = parseParams(
    Object.fromEntries(Object.entries(source).filter(([k]) => !['message', 'reason', 'curve', 'curves', 'name', 'explanation'].includes(k))),
    ignored,
  ) as Record<string, unknown>;
  delete settings.straighten;
  const curves = (d.curve ?? d.curves ?? source.curve) as Record<string, unknown> | undefined;
  if (curves && typeof curves === 'object' && !Array.isArray(curves)) {
    for (const [ch, pts] of Object.entries(curves)) {
      const points = parseCurvePoints(pts);
      const channel = parseChannel(ch);
      if (points) settings[channel === 'rgb' ? 'curveRgb' : channel === 'red' ? 'curveRed' : channel === 'green' ? 'curveGreen' : 'curveBlue'] = points;
    }
  } else if (Array.isArray(curves)) {
    const points = parseCurvePoints(curves);
    if (points) settings.curveRgb = points;
  }
  const message = typeof d.message === 'string' ? d.message : typeof d.reason === 'string' ? d.reason : '';
  return { settings: settings as PartialSettings, message: message.slice(0, 500), ignored };
}

export interface CullSuggestion {
  index: number;
  rating: number;
  flag: Flag;
  reason: string;
}

/** {"ratings":[{"index":1,"rating":4,"flag":"pick","reason":"…"}]} → validated list (index 1-based in, 0-based out). */
export function parseCullAnswer(data: unknown, count: number): CullSuggestion[] {
  const list = Array.isArray(data) ? data : data && typeof data === 'object' ? ((data as Record<string, unknown>).ratings ?? (data as Record<string, unknown>).photos) : null;
  if (!Array.isArray(list)) return [];
  const out: CullSuggestion[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const it = item as Record<string, unknown>;
    const idx = toNumber(it.index ?? it.photo ?? it.id);
    const rating = toNumber(it.rating ?? it.stars);
    if (idx === null || rating === null) continue;
    const index = Math.round(idx) - 1;
    if (index < 0 || index >= count || out.some((o) => o.index === index)) continue;
    const f = typeof it.flag === 'string' ? norm(it.flag) : '';
    out.push({
      index,
      rating: Math.max(0, Math.min(5, Math.round(rating))),
      flag: f === 'pick' || f === 'picked' ? 'pick' : f === 'reject' || f === 'rejected' ? 'reject' : null,
      reason: typeof it.reason === 'string' ? it.reason.slice(0, 300) : '',
    });
  }
  return out;
}

export const LOOK_SCHEMA_HINT = `Answer with JSON: {"message": "one short sentence describing the edit", "settings": {<parameter>: <value>, ...}, "curve": {"rgb": [[0,0],[255,255]]}} — "curve" is optional (channels rgb/red/green/blue, points 0..255). Use only these parameter names (absolute values): temp, tint, exposure, contrast, highlights, shadows, whites, blacks, texture, clarity, dehaze, vibrance, saturation, treatment ("color"|"bw"), hue<Band>/sat<Band>/lum<Band> (Band = ${BANDS.join(', ')}), gradeShadowHue, gradeShadowSat, gradeShadowLum, gradeMidHue, gradeMidSat, gradeMidLum, gradeHighHue, gradeHighSat, gradeHighLum, gradeGlobalHue, gradeGlobalSat, gradeGlobalLum, gradeBlending, gradeBalance, sharpenAmount, sharpenRadius, sharpenDetail, sharpenMasking, nrLuminance, nrDetail, nrColor, vignetteAmount, vignetteMidpoint, vignetteRoundness, vignetteFeather, grainAmount, grainSize, grainRoughness. Ranges: exposure -5..5 (EV), sharpenRadius 0.5..3, hues 0..360, saturations 0..100, everything else -100..100 or 0..100. Parameters you leave out are reset to 0/default.`;
