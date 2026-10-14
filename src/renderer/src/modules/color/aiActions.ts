/**
 * Color Studio ↔ AI assistant protocol: instructions, document summary and a validating
 * executor for the actions the model returns. Pure (unit tested in aiActions.test.ts).
 */
import { normalizeHex, formatColor } from './colormath';
import { HARMONY_RULES, clampSpread, isRule, ruleInfo } from './harmony';
import { evenStops, gradientCss, isGradientType, makeStop, type GradientDoc } from './gradient';
import {
  MAX_SWATCHES,
  baseIndex,
  regenerate,
  renameSwatch,
  replaceColors,
  setBaseIndex,
  setRule,
  setSpread,
  setSwatchHex,
  setWheel,
  sortSwatches,
  spreadOf,
  toggleLock,
  type ColorDoc,
  type SortKey,
} from './state';
import { contrastHex } from './a11y';
import { parseTags } from './library';

export const COLOR_AI_INSTRUCTIONS = `You help the user design color palettes and gradients in Color Studio (like Adobe Color).
The document is ONE palette of 1-${MAX_SWATCHES} color swatches (usually 5), indexed from 0. One swatch is the BASE color: harmony rules derive the other unlocked swatches from it. Locked swatches never change — keep their hex values when you replace the palette.

ACTION TYPES (each action is a JSON object with a "type" field; colors are "#RRGGBB" hex strings):
1. {"type":"setPalette","colors":["#RRGGBB", ...],"names":["Name", ...],"name":"Palette name"}
   Replaces all colors (1-${MAX_SWATCHES} entries; "names" and "name" are optional). The harmony rule becomes "custom".
2. {"type":"setSwatch","index":0,"color":"#RRGGBB","name":"Optional name"}
   Changes one swatch (index 0-based). Editing a non-base swatch switches the rule to "custom".
3. {"type":"setBase","color":"#RRGGBB","index":2}
   Sets the base color ("index" optional: which swatch becomes the base). Other unlocked swatches are regenerated from the current harmony rule.
4. {"type":"setHarmony","rule":"analogous|monochromatic|triad|complementary|split-complementary|square|compound|shades|custom","spread":30,"wheel":"ryb|rgb"}
   Applies a harmony rule from the base color. "spread" is optional: an angle in degrees (analogous 4-60, split-complementary 4-85, compound 4-85) or an amount 0.04-0.45 (monochromatic, shades = brightness step). "wheel" is optional: "ryb" = artistic wheel (default), "rgb" = scientific wheel.
5. {"type":"setGradient","gradientType":"linear|radial|conic","angle":90,"stops":[{"color":"#RRGGBB","position":0},{"color":"#RRGGBB","position":100}],"fromPalette":false,"interpolation":"srgb|oklab","shape":"circle|ellipse"}
   Edits the gradient. Every field is optional. "angle" 0-360 degrees (0 = to top, 90 = to right). "stops": 2-10 stops, "position" 0-100 (%). "fromPalette": true uses the palette colors as evenly spaced stops.
6. {"type":"setName","name":"Palette name","tags":["tag", ...]}
7. {"type":"lockSwatch","index":0,"locked":true}
8. {"type":"sortPalette","by":"lightness|hue|saturation","direction":"asc|desc"}

EXAMPLES
User: "make it a warm sunset palette" → {"message":"Here is a warm sunset palette.","actions":[{"type":"setPalette","colors":["#2B1B3D","#7A2E5C","#D9485F","#F28C4B","#FFD27F"],"names":["Night Plum","Dusk Berry","Coral Glow","Tangerine","Golden Hour"],"name":"Sunset"}]}
User: "use a triad based on teal" → {"message":"Teal triad applied.","actions":[{"type":"setBase","color":"#1A9C9C"},{"type":"setHarmony","rule":"triad"}]}
User: "make a diagonal gradient from these colors" → {"message":"Done.","actions":[{"type":"setGradient","gradientType":"linear","angle":135,"fromPalette":true}]}

Good palettes have a clear range of lightness (at least one dark and one light color) unless the user asks otherwise. When the user asks about accessibility, compare WCAG contrast ratios (4.5:1 for normal text, 3:1 for large text and UI).`;

export function describeDoc(doc: ColorDoc): string {
  const bi = baseIndex(doc);
  const info = ruleInfo(doc.rule);
  const spread = info.spread ? (info.spread.kind === 'angle' ? ` (spread ${Math.round(spreadOf(doc))}°)` : ` (step ${spreadOf(doc).toFixed(2)})`) : '';
  const lines = doc.swatches.map((s, i) => {
    const flags = [i === bi ? 'BASE' : '', s.locked ? 'locked' : ''].filter(Boolean).join(', ');
    return `${i}. ${s.hex.toUpperCase()}${s.name ? ` "${s.name}"` : ''} — HSB ${formatColor(s.hex, 'hsb')}${flags ? ` [${flags}]` : ''}`;
  });
  const hexes = doc.swatches.map((s) => s.hex);
  let best = { a: 0, b: 0, r: 0 };
  for (let i = 0; i < hexes.length; i++) for (let j = i + 1; j < hexes.length; j++) {
    const r = contrastHex(hexes[i], hexes[j]);
    if (r > best.r) best = { a: i, b: j, r };
  }
  return [
    `Palette "${doc.name}"${doc.tags.length ? ` (tags: ${doc.tags.join(', ')})` : ''}: ${doc.swatches.length} colors, harmony rule: ${doc.rule}${spread}, wheel: ${doc.wheel}, base swatch index ${bi}.`,
    ...lines,
    hexes.length > 1 ? `Highest contrast pair: ${best.a} & ${best.b} (${best.r.toFixed(2)}:1).` : '',
    `Gradient: ${gradientCss(doc.gradient)}`,
  ]
    .filter(Boolean)
    .join('\n');
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
const int = (v: unknown): number | null => {
  const n = num(v);
  return n === null ? null : Math.round(n);
};

export interface ActionResult {
  doc: ColorDoc;
  applied: number;
  notes: string[];
}

/**
 * Applies untrusted AI actions to a document. Every field is validated/clamped; unknown
 * action types and invalid values are skipped (and reported in `notes`).
 */
export function applyColorActions(input: ColorDoc, actions: unknown[]): ActionResult {
  let doc = input;
  let applied = 0;
  const notes: string[] = [];
  const skip = (why: string) => notes.push(why);
  for (const raw of actions.slice(0, 50)) {
    if (!raw || typeof raw !== 'object') continue;
    const a = raw as Record<string, unknown>;
    switch (a.type) {
      case 'setPalette': {
        const list = Array.isArray(a.colors) ? a.colors : [];
        const names = Array.isArray(a.names) ? a.names : [];
        const colors = list
          .map((c, i) => {
            const obj = c && typeof c === 'object' ? (c as Record<string, unknown>) : null;
            const hex = normalizeHex(obj ? obj.hex ?? obj.color : c);
            const nm = obj && typeof obj.name === 'string' ? obj.name : typeof names[i] === 'string' ? (names[i] as string) : undefined;
            return hex ? { hex, name: nm?.slice(0, 80) } : null;
          })
          .filter((c): c is { hex: string; name: string | undefined } => Boolean(c))
          .slice(0, MAX_SWATCHES);
        if (!colors.length) {
          skip('setPalette without valid colors');
          break;
        }
        doc = replaceColors(doc, colors);
        if (typeof a.name === 'string' && a.name.trim()) doc = { ...doc, name: a.name.trim().slice(0, 120) };
        applied++;
        break;
      }
      case 'setSwatch': {
        const i = int(a.index);
        const hex = normalizeHex(a.color ?? a.hex);
        if (i === null || i < 0 || i >= doc.swatches.length) {
          skip(`setSwatch: no swatch ${String(a.index)}`);
          break;
        }
        if (doc.swatches[i].locked) {
          skip(`setSwatch: swatch ${i} is locked`);
          break;
        }
        if (hex) doc = setSwatchHex(doc, i, hex);
        if (typeof a.name === 'string') doc = renameSwatch(doc, i, a.name);
        if (hex || typeof a.name === 'string') applied++;
        break;
      }
      case 'setBase': {
        const i = int(a.index);
        if (i !== null && i >= 0 && i < doc.swatches.length) doc = { ...doc, baseId: doc.swatches[i].id };
        const hex = normalizeHex(a.color ?? a.hex);
        const bi = baseIndex(doc);
        if (hex && !doc.swatches[bi].locked) {
          doc = { ...doc, swatches: doc.swatches.map((s, k) => (k === bi ? { ...s, hex } : s)) };
        }
        doc = regenerate(doc);
        applied++;
        break;
      }
      case 'setHarmony': {
        if (a.wheel === 'ryb' || a.wheel === 'rgb') doc = { ...doc, wheel: a.wheel };
        const rule = isRule(a.rule) ? a.rule : null;
        if (!rule) {
          if (a.wheel === 'ryb' || a.wheel === 'rgb') {
            doc = setWheel(doc, a.wheel);
            applied++;
          } else skip(`setHarmony: unknown rule ${String(a.rule)}`);
          break;
        }
        doc = setRule(doc, rule);
        const spread = num(a.spread);
        if (spread !== null && ruleInfo(rule).spread) doc = setSpread(doc, clampSpread(rule, spread), rule);
        applied++;
        break;
      }
      case 'setGradient': {
        const g: GradientDoc = { ...doc.gradient };
        const kind = a.gradientType ?? a.kind ?? a.gradient;
        if (isGradientType(kind)) g.type = kind;
        const angle = num(a.angle);
        if (angle !== null) g.angle = ((angle % 360) + 360) % 360;
        if (a.interpolation === 'oklab' || a.interpolation === 'srgb') g.interpolation = a.interpolation;
        if (a.shape === 'circle' || a.shape === 'ellipse') g.shape = a.shape;
        const cx = num(a.cx);
        const cy = num(a.cy);
        if (cx !== null) g.cx = Math.max(0, Math.min(100, cx));
        if (cy !== null) g.cy = Math.max(0, Math.min(100, cy));
        if (a.fromPalette === true) g.stops = evenStops(doc.swatches.map((s) => s.hex));
        else if (Array.isArray(a.stops)) {
          const stops = a.stops
            .map((s, i, all) => {
              const o: Record<string, unknown> = s && typeof s === 'object' ? (s as Record<string, unknown>) : { color: s };
              const hex = normalizeHex(o.color ?? o.hex);
              const pos = num(o.position ?? o.offset);
              return hex ? makeStop(hex, pos ?? (all.length > 1 ? (i / (all.length - 1)) * 100 : 0)) : null;
            })
            .filter((s): s is ReturnType<typeof makeStop> => Boolean(s))
            .slice(0, 10);
          if (stops.length >= 2) g.stops = stops;
          else skip('setGradient: needs at least 2 valid stops');
        }
        doc = { ...doc, gradient: g };
        applied++;
        break;
      }
      case 'setName': {
        if (typeof a.name === 'string' && a.name.trim()) doc = { ...doc, name: a.name.trim().slice(0, 120) };
        if (Array.isArray(a.tags)) doc = { ...doc, tags: parseTags(a.tags.filter((t) => typeof t === 'string').join(',')) };
        applied++;
        break;
      }
      case 'lockSwatch': {
        const i = int(a.index);
        if (i === null || i < 0 || i >= doc.swatches.length) {
          skip(`lockSwatch: no swatch ${String(a.index)}`);
          break;
        }
        doc = toggleLock(doc, i, a.locked !== false);
        applied++;
        break;
      }
      case 'sortPalette': {
        const by: SortKey = a.by === 'hue' || a.by === 'saturation' ? a.by : 'lightness';
        doc = sortSwatches(doc, by, a.direction === 'desc' ? 'desc' : 'asc');
        applied++;
        break;
      }
      case 'setBaseIndex': {
        const i = int(a.index);
        if (i !== null && i >= 0 && i < doc.swatches.length) {
          doc = setBaseIndex(doc, i);
          applied++;
        }
        break;
      }
      default:
        skip(`unknown action ${String(a.type)}`);
    }
  }
  return { doc, applied, notes };
}

export const RULE_LIST_TEXT = HARMONY_RULES.map((r) => r.id).join(', ');
