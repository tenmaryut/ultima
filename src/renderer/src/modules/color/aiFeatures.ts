/**
 * Extra AI features of Color Studio (palette from a description, naming colors,
 * accessibility repair). They use whichever AI the user connected (runAIJson).
 */
import { runAIJson } from '../../core/ai/client';
import { normalizeHex } from './colormath';
import { checkPairs, defaultTextPairs, fixPairs, type PairCheck } from './a11y';

const SYSTEM = 'You are an expert color designer working inside Ultima Color Studio. You know color theory, brand design and WCAG accessibility.';

export interface GeneratedPalette {
  name: string;
  colors: { hex: string; name: string }[];
  rationale: string;
}

function cleanText(v: unknown, max: number): string {
  return typeof v === 'string' ? v.replace(/[<>]/g, '').trim().slice(0, max) : '';
}

export async function paletteFromDescription(description: string, count: number, language: string, signal?: AbortSignal): Promise<GeneratedPalette> {
  const n = Math.max(2, Math.min(10, Math.round(count)));
  const { data } = await runAIJson<{ name?: unknown; colors?: unknown; rationale?: unknown }>({
    system: SYSTEM,
    prompt: `Create a color palette of exactly ${n} colors for this description (a mood, brand, season, place or idea):
"""${description.slice(0, 2000)}"""

Order the colors from darkest to lightest unless another order clearly works better. Give every color a short evocative name.
Reply as JSON: {"name": "Palette name", "colors": [{"hex": "#RRGGBB", "name": "Color name"}], "rationale": "2-3 sentences on why these colors fit"}.
Write the names and the rationale in ${language}.`,
    signal,
  });
  const list = Array.isArray(data?.colors) ? data.colors : [];
  const colors = list
    .map((c) => {
      const o: Record<string, unknown> = c && typeof c === 'object' ? (c as Record<string, unknown>) : { hex: c };
      const hex = normalizeHex(o.hex ?? o.color);
      return hex ? { hex, name: cleanText(o.name, 60) } : null;
    })
    .filter((c): c is { hex: string; name: string } => Boolean(c))
    .slice(0, 12);
  if (!colors.length) throw new Error('The AI did not return any colors. Try again or rephrase the description.');
  return { name: cleanText(data?.name, 80) || description.slice(0, 40), colors, rationale: cleanText(data?.rationale, 1200) };
}

export async function nameColors(hexes: string[], language: string, signal?: AbortSignal): Promise<string[]> {
  const { data } = await runAIJson<{ names?: unknown }>({
    system: SYSTEM,
    prompt: `Give each of these colors a short, evocative, human-friendly name (1-3 words, like "Dusty Rose" or "Midnight Teal"). Names must be distinct.
Colors: ${hexes.map((h, i) => `${i}: ${h.toUpperCase()}`).join(', ')}
Reply as JSON: {"names": ["name for color 0", "name for color 1", ...]} with exactly ${hexes.length} names, in ${language}.`,
    signal,
  });
  const names = Array.isArray(data?.names) ? data.names.map((n) => cleanText(n, 60)) : [];
  if (!names.some(Boolean)) throw new Error('The AI did not return any names.');
  return hexes.map((_, i) => names[i] ?? '');
}

export interface AccessibleResult {
  colors: string[];
  pairs: PairCheck[];
  notes: string;
  /** True when the local contrast fixer had to adjust the AI's answer. */
  adjusted: boolean;
}

/**
 * Asks the AI to adjust the palette minimally so text pairs pass WCAG AA, then verifies
 * the answer locally and nudges any pair that still fails.
 */
export async function makeAccessible(hexes: string[], locked: boolean[], language: string, signal?: AbortSignal): Promise<AccessibleResult> {
  const defaults = defaultTextPairs(hexes);
  const { data } = await runAIJson<{ colors?: unknown; pairs?: unknown; notes?: unknown }>({
    system: SYSTEM,
    prompt: `Adjust this palette as little as possible (keep each hue and the overall mood) so that the color pairs used for TEXT reach at least WCAG AA contrast 4.5:1.
Colors (index: hex): ${hexes.map((h, i) => `${i}: ${h.toUpperCase()}${locked[i] ? ' (locked — must not change)' : ''}`).join(', ')}
Suggested text/background pairs (text index → background index): ${defaults.map((p) => `${p.text}→${p.background}`).join(', ') || 'choose sensible ones'}
Reply as JSON: {"colors": ["#RRGGBB", ...] (same count and order), "pairs": [{"text": 0, "background": 4}], "notes": "one or two sentences on what changed, in ${language}"}.`,
    signal,
  });
  const raw = Array.isArray(data?.colors) ? data.colors : [];
  let colors = hexes.map((h, i) => (locked[i] ? h : normalizeHex(raw[i]) ?? h));
  const pairsRaw = Array.isArray(data?.pairs) ? data.pairs : [];
  let pairs = pairsRaw
    .map((p) => {
      const o = (p ?? {}) as Record<string, unknown>;
      const text = Number(o.text);
      const background = Number(o.background);
      return Number.isInteger(text) && Number.isInteger(background) && text >= 0 && background >= 0 && text < hexes.length && background < hexes.length && text !== background
        ? { text, background }
        : null;
    })
    .filter((p): p is { text: number; background: number } => Boolean(p));
  if (!pairs.length) pairs = defaultTextPairs(colors);
  const before = colors.join();
  if (checkPairs(colors, pairs).some((p) => !p.pass)) colors = fixPairs(colors, pairs, 4.5, locked);
  return { colors, pairs: checkPairs(colors, pairs), notes: cleanText(data?.notes, 600), adjusted: colors.join() !== before };
}
