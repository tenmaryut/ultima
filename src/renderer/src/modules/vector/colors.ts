import { luminance, parseColor, toCss, toHex, type RGBA } from '../../core/utils/color';
import type { Paint, VObject } from './model';

const NAMED_RAW =
  'aliceblue:f0f8ff,antiquewhite:faebd7,aqua:00ffff,aquamarine:7fffd4,azure:f0ffff,beige:f5f5dc,bisque:ffe4c4,black:000000,' +
  'blanchedalmond:ffebcd,blue:0000ff,blueviolet:8a2be2,brown:a52a2a,burlywood:deb887,cadetblue:5f9ea0,chartreuse:7fff00,' +
  'chocolate:d2691e,coral:ff7f50,cornflowerblue:6495ed,cornsilk:fff8dc,crimson:dc143c,cyan:00ffff,darkblue:00008b,' +
  'darkcyan:008b8b,darkgoldenrod:b8860b,darkgray:a9a9a9,darkgreen:006400,darkgrey:a9a9a9,darkkhaki:bdb76b,darkmagenta:8b008b,' +
  'darkolivegreen:556b2f,darkorange:ff8c00,darkorchid:9932cc,darkred:8b0000,darksalmon:e9967a,darkseagreen:8fbc8f,' +
  'darkslateblue:483d8b,darkslategray:2f4f4f,darkslategrey:2f4f4f,darkturquoise:00ced1,darkviolet:9400d3,deeppink:ff1493,' +
  'deepskyblue:00bfff,dimgray:696969,dimgrey:696969,dodgerblue:1e90ff,firebrick:b22222,floralwhite:fffaf0,forestgreen:228b22,' +
  'fuchsia:ff00ff,gainsboro:dcdcdc,ghostwhite:f8f8ff,gold:ffd700,goldenrod:daa520,gray:808080,green:008000,greenyellow:adff2f,' +
  'grey:808080,honeydew:f0fff0,hotpink:ff69b4,indianred:cd5c5c,indigo:4b0082,ivory:fffff0,khaki:f0e68c,lavender:e6e6fa,' +
  'lavenderblush:fff0f5,lawngreen:7cfc00,lemonchiffon:fffacd,lightblue:add8e6,lightcoral:f08080,lightcyan:e0ffff,' +
  'lightgoldenrodyellow:fafad2,lightgray:d3d3d3,lightgreen:90ee90,lightgrey:d3d3d3,lightpink:ffb6c1,lightsalmon:ffa07a,' +
  'lightseagreen:20b2aa,lightskyblue:87cefa,lightslategray:778899,lightslategrey:778899,lightsteelblue:b0c4de,' +
  'lightyellow:ffffe0,lime:00ff00,limegreen:32cd32,linen:faf0e6,magenta:ff00ff,maroon:800000,mediumaquamarine:66cdaa,' +
  'mediumblue:0000cd,mediumorchid:ba55d3,mediumpurple:9370db,mediumseagreen:3cb371,mediumslateblue:7b68ee,' +
  'mediumspringgreen:00fa9a,mediumturquoise:48d1cc,mediumvioletred:c71585,midnightblue:191970,mintcream:f5fffa,' +
  'mistyrose:ffe4e1,moccasin:ffe4b5,navajowhite:ffdead,navy:000080,oldlace:fdf5e6,olive:808000,olivedrab:6b8e23,' +
  'orange:ffa500,orangered:ff4500,orchid:da70d6,palegoldenrod:eee8aa,palegreen:98fb98,paleturquoise:afeeee,' +
  'palevioletred:db7093,papayawhip:ffefd5,peachpuff:ffdab9,peru:cd853f,pink:ffc0cb,plum:dda0dd,powderblue:b0e0e6,' +
  'purple:800080,rebeccapurple:663399,red:ff0000,rosybrown:bc8f8f,royalblue:4169e1,saddlebrown:8b4513,salmon:fa8072,' +
  'sandybrown:f4a460,seagreen:2e8b57,seashell:fff5ee,sienna:a0522d,silver:c0c0c0,skyblue:87ceeb,slateblue:6a5acd,' +
  'slategray:708090,slategrey:708090,snow:fffafa,springgreen:00ff7f,steelblue:4682b4,tan:d2b48c,teal:008080,thistle:d8bfd8,' +
  'tomato:ff6347,turquoise:40e0d0,violet:ee82ee,wheat:f5deb3,white:ffffff,whitesmoke:f5f5f5,yellow:ffff00,yellowgreen:9acd32';

const NAMED = new Map<string, string>(NAMED_RAW.split(',').map((e) => e.split(':') as [string, string]));

/** Parses any CSS color (hex, rgb(), hsl(), named) into RGBA. */
export function parseAnyColor(input: string | null | undefined): RGBA | null {
  if (!input) return null;
  const s = input.trim().toLowerCase();
  const named = NAMED.get(s);
  return parseColor(named ? `#${named}` : s);
}

/** Normalizes a CSS color to #rrggbb or rgba(); multiplies an extra opacity in. */
export function normalizeColor(input: string | null | undefined, opacity = 1): string | null {
  const c = parseAnyColor(input);
  if (!c) return null;
  return toCss({ ...c, a: Math.max(0, Math.min(1, c.a * opacity)) });
}

/** #rrggbb part of a color (alpha dropped) for comparisons. */
export function rgbKey(color: string): string | null {
  const c = parseAnyColor(color);
  return c ? toHex(c) : null;
}

export function colorAlpha(color: string): number {
  return parseAnyColor(color)?.a ?? 1;
}

/** Replaces the RGB of `color` with `next` but keeps the original alpha. */
export function replaceRgb(color: string, next: string): string {
  const a = parseAnyColor(color);
  const b = parseAnyColor(next);
  if (!a || !b) return color;
  return toCss({ ...b, a: a.a * b.a });
}

export function mapPaintColors(paint: Paint, fn: (c: string) => string): Paint {
  switch (paint.type) {
    case 'solid':
      return { ...paint, color: fn(paint.color) };
    case 'linear':
    case 'radial':
      return { ...paint, stops: paint.stops.map((s) => ({ ...s, color: fn(s.color) })) };
    default:
      return paint;
  }
}

/** Applies `fn` to every fill/stroke/gradient/shadow color in the objects (deep). */
export function mapObjectColors(objects: VObject[], fn: (c: string) => string): VObject[] {
  return objects.map((o) => {
    let next: VObject = { ...o, fill: mapPaintColors(o.fill, fn), stroke: { ...o.stroke, paint: mapPaintColors(o.stroke.paint, fn) } } as VObject;
    if (o.effects.shadow) next = { ...next, effects: { ...o.effects, shadow: { ...o.effects.shadow, color: fn(o.effects.shadow.color) } } };
    if (next.type === 'group') next = { ...next, children: mapObjectColors(next.children, fn) };
    return next;
  });
}

/** Unique colors (#rrggbb) used by the objects, most used first. */
export function collectColors(objects: VObject[]): string[] {
  const counts = new Map<string, number>();
  const add = (c: string) => {
    const k = rgbKey(c);
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  };
  mapObjectColors(objects, (c) => {
    add(c);
    return c;
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
}

/** Recolors with an explicit mapping (keys/values are any CSS colors; matching ignores alpha). */
export function recolorWithMapping(objects: VObject[], mapping: Record<string, string>): { objects: VObject[]; changed: number } {
  const map = new Map<string, string>();
  for (const [from, to] of Object.entries(mapping)) {
    const k = rgbKey(from);
    if (k && parseAnyColor(to)) map.set(k, to);
  }
  let changed = 0;
  const out = mapObjectColors(objects, (c) => {
    const k = rgbKey(c);
    const to = k ? map.get(k) : undefined;
    if (!to) return c;
    changed++;
    return replaceRgb(c, to);
  });
  return { objects: out, changed };
}

/** Builds a mapping that sends the document colors (by lightness) onto a palette (by lightness). */
export function paletteMapping(docColors: string[], palette: string[]): Record<string, string> {
  const validPalette = palette.filter((c) => parseAnyColor(c));
  if (!docColors.length || !validPalette.length) return {};
  const lum = (c: string) => luminance(parseAnyColor(c) ?? { r: 0, g: 0, b: 0 });
  const doc = [...docColors].sort((a, b) => lum(a) - lum(b));
  const pal = [...validPalette].sort((a, b) => lum(a) - lum(b));
  const mapping: Record<string, string> = {};
  doc.forEach((c, i) => {
    const idx = doc.length === 1 ? Math.floor(pal.length / 2) : Math.round((i / (doc.length - 1)) * (pal.length - 1));
    mapping[c] = pal[idx];
  });
  return mapping;
}
