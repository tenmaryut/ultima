import type { AIAction, AIContext } from '../../components/ai/AIAssistantPanel';
import { sanitizeSvg, stripHtml } from '../../core/ai/sanitize';
import { canvasToAIImage } from '../../core/utils/image';
import { t as tr } from '../../core/i18n';
import { collectColors, normalizeColor, paletteMapping, recolorWithMapping } from './colors';
import type { EditorCore } from './editor';
import { bakeScale, worldMatrix } from './geometry';
import { chain, scale, translate } from './matrix';
import {
  clampInt,
  clampNum,
  createEllipse,
  createGroup,
  createLine,
  createPath,
  createPolygon,
  createRect,
  createStar,
  createText,
  defaultStroke,
  findObject,
  NONE,
  solid,
  BLEND_MODES,
  type BlendMode,
  type Paint,
  type VDoc,
  type VObject,
} from './model';
import { alignByIds, arrangeByIds, getFrame, groupByIds, mapTree, removeByIds, setFrame, topLevelSelection, type AlignMode, type ArrangeMode } from './ops';
import { parsePathData } from './path';
import { linearAt } from './panels/PaintField';
import { svgToCanvas } from './raster';
import { exportArtboardSvg } from './svgexport';
import { importSvg } from './svgimport';
import { insertObjects } from './tools/common';

export const VECTOR_AI_INSTRUCTIONS = `You edit a vector illustration (like Adobe Illustrator).
Coordinates are in px, relative to the top-left corner of the ACTIVE artboard (x to the right, y down). Rotation is in degrees, clockwise.
Colors are CSS colors ("#ff6600", "rgba(0,0,0,0.5)", "transparent" or "none"). Gradients can be given as {"type":"linear","colors":["#f00","#00f"],"angle":90} or {"type":"radial","colors":["#fff","#000"]} wherever a fill/stroke color is accepted (angle: 0 = left→right, 90 = top→bottom).
Use the object ids listed in CURRENT DOCUMENT. Objects created in the same reply can't be referenced by id.

ACTIONS
- {"type":"addShape","shape":"rect"|"ellipse"|"polygon"|"star"|"line","x":number,"y":number,"w":number,"h":number,"fill":color,"stroke":color,"strokeWidth":0-500,"radius":corner radius px (rect),"sides":3-64 (polygon),"points":3-64 (star),"innerRadius":0.05-0.95 (star),"rotation":deg,"opacity":0-1,"name":string}
  x/y/w/h is the bounding box. For "line", the line goes from (x,y) to (x+w,y+h) (w/h may be negative).
- {"type":"addPath","d":"SVG path data","fill":color,"stroke":color,"strokeWidth":number,"name":string}  (coordinates in artboard px)
- {"type":"addText","text":string (\\n for new lines),"x":number,"y":number (top-left of the text),"size":1-1000,"font":font family,"weight":100-900,"fill":color,"align":"left"|"center"|"right","italic":boolean}
- {"type":"update","id":string,"props":{ any of: "x","y","w","h","rotation","fill","stroke","strokeWidth","opacity" 0-1,"name","text","size","font","weight","radius","sides","points","innerRadius","visible","locked","blend" (normal|multiply|screen|overlay|darken|lighten|color-dodge|color-burn|hard-light|soft-light|difference|exclusion|hue|saturation|color|luminosity),"shadow" ({"x","y","blur","color"} or null),"blur" px }}
- {"type":"delete","ids":[string]}
- {"type":"align","ids":[string],"mode":"left"|"center"|"right"|"top"|"middle"|"bottom","to":"selection"|"artboard"}  (one id = align to the artboard)
- {"type":"arrange","id":string,"mode":"front"|"back"|"forward"|"backward"}
- {"type":"group","ids":[string],"name":string}
- {"type":"recolor","mapping":{"#oldcolor":"#newcolor"}}  or  {"type":"recolor","palette":["#..","#.."]} (maps the document colors onto the palette by lightness)
- {"type":"addSvg","svg":"<svg ...>...</svg>","x":number,"y":number,"w":number}  (inserts SVG artwork as a group; x/y/w optional, default: centered, fitted to the artboard)
- {"type":"setArtboard","width":1-20000,"height":1-20000,"background":color|"transparent"}

EXAMPLES
User: "add a red circle in the middle" (1080×1080 artboard) →
{"message":"Added a red circle in the center.","actions":[{"type":"addShape","shape":"ellipse","x":440,"y":440,"w":200,"h":200,"fill":"#e53935","stroke":"none"}]}
User: "make the title bigger and blue" →
{"message":"Done.","actions":[{"type":"update","id":"<title id>","props":{"size":96,"fill":"#1e63d6"}}]}

Design well: balanced composition, aligned elements, harmonious colors, readable text sizes.`;

const r1 = (n: number) => Math.round(n * 10) / 10;

function paintText(p: Paint): string {
  if (p.type === 'none') return 'none';
  if (p.type === 'solid') return p.color;
  return `${p.type}-gradient(${p.stops.map((s) => s.color).join(', ')})`;
}

/** Plain-text summary of the document for the assistant. */
export function describeDocument(core: EditorCore): string {
  const doc = core.doc;
  const ab = core.activeArtboard;
  const lines: string[] = [];
  lines.push(`Document "${doc.name}"`);
  lines.push('Artboards:');
  for (const a of doc.artboards) {
    lines.push(`- "${a.name}" ${a.width}×${a.height}px background ${a.background ?? 'transparent'}${a.id === ab.id ? ' (ACTIVE)' : ''} at (${a.x - ab.x}, ${a.y - ab.y})`);
  }
  lines.push('Objects (bottom → top, coordinates relative to the active artboard):');
  let count = 0;
  const walk = (list: VObject[], depth: number) => {
    for (const o of list) {
      if (count++ > 160) return;
      const f = getFrame(doc.objects, o.id);
      const box = f ? `x=${r1(f.x - ab.x)} y=${r1(f.y - ab.y)} w=${r1(f.w)} h=${r1(f.h)}${Math.abs(f.rotation) > 0.05 ? ` rotation=${r1(f.rotation)}` : ''}` : '';
      const parts = [`id=${o.id}`, o.type, `"${o.name}"`, box];
      if (o.type !== 'group' && o.type !== 'image' && o.type !== 'raw') {
        if (o.type !== 'line') parts.push(`fill=${paintText(o.fill)}`);
        if (o.stroke.paint.type !== 'none' && o.stroke.width > 0) parts.push(`stroke=${paintText(o.stroke.paint)} ${o.stroke.width}px`);
      }
      if (o.type === 'text') parts.push(`text=${JSON.stringify(o.text.slice(0, 120))} font="${o.fontFamily}" size=${r1(o.fontSize)} weight=${o.fontWeight}`);
      if (o.type === 'rect' && o.radius) parts.push(`radius=${r1(o.radius)}`);
      if (o.opacity < 1) parts.push(`opacity=${o.opacity}`);
      if (!o.visible) parts.push('hidden');
      if (o.locked) parts.push('locked');
      lines.push(`${'  '.repeat(depth)}- ${parts.filter(Boolean).join(' ')}`);
      if (o.type === 'group') walk(o.children, depth + 1);
    }
  };
  walk(doc.objects, 0);
  if (count > 160) lines.push(`… (${count - 160} more objects not listed)`);
  if (!doc.objects.length) lines.push('(no objects yet)');
  const sel = topLevelSelection(doc.objects, core.selection);
  lines.push(`Selection: ${sel.length ? sel.join(', ') : 'nothing'}`);
  const colors = collectColors(doc.objects).slice(0, 16);
  if (colors.length) lines.push(`Colors used: ${colors.join(', ')}`);
  if (doc.swatches.length) lines.push(`Swatches: ${doc.swatches.slice(0, 24).join(', ')}`);
  return lines.join('\n');
}

export async function artboardSnapshot(core: EditorCore, maxSize = 1024) {
  const ab = core.activeArtboard;
  const svg = exportArtboardSvg(core.doc, ab, { pretty: false });
  const canvas = await svgToCanvas(svg, ab.width, ab.height, Math.min(4, maxSize / Math.max(ab.width, ab.height)), ab.background ? null : '#ffffff');
  return canvasToAIImage(canvas, { maxSize });
}

export async function buildContext(core: EditorCore): Promise<AIContext> {
  let image: AIContext['image'] = null;
  try {
    image = await artboardSnapshot(core);
  } catch {
    image = null;
  }
  return { summary: describeDocument(core), image };
}

/* ------------------------------- Validation ------------------------------- */

function color(v: unknown): Paint | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'none' || s === 'transparent' || s === '') return NONE;
    const c = normalizeColor(v);
    return c ? solid(c) : null;
  }
  if (typeof v === 'object' && v) {
    const g = v as Record<string, unknown>;
    const list = Array.isArray(g.colors) ? g.colors : Array.isArray(g.stops) ? g.stops.map((s) => (typeof s === 'object' && s ? (s as Record<string, unknown>).color : s)) : [];
    const colors = list.map((c) => normalizeColor(typeof c === 'string' ? c : null)).filter((c): c is string => Boolean(c)).slice(0, 8);
    if (colors.length < 2) return colors.length ? solid(colors[0]) : null;
    const stops = colors.map((c, i) => ({ offset: i / (colors.length - 1), color: c }));
    if (g.type === 'radial') return { type: 'radial', stops, cx: 0.5, cy: 0.5, rx: 0.5, ry: 0.5 };
    return { type: 'linear', stops, ...linearAt(clampNum(g.angle, -360, 360, 0), { width: 1, height: 1 }) };
  }
  return null;
}

const num = (v: unknown, min: number, max: number, fallback: number) => clampNum(v, min, max, fallback);
const str = (v: unknown, max = 200) => (typeof v === 'string' ? stripHtml(v).slice(0, max) : undefined);
const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : typeof v === 'string' ? [v] : []);

const ALIGN: Record<string, AlignMode> = { left: 'left', center: 'hcenter', hcenter: 'hcenter', right: 'right', top: 'top', middle: 'vcenter', vcenter: 'vcenter', bottom: 'bottom' };
const ARRANGE: Record<string, ArrangeMode> = { front: 'front', back: 'back', forward: 'forward', backward: 'backward' };

/** Executes assistant actions as ONE undo step. Unknown actions are ignored. */
export function applyAIActions(core: EditorCore, actions: AIAction[]): string {
  let doc: VDoc = core.doc;
  let ab = core.activeArtboard;
  const created: string[] = [];
  let done = 0;
  let skipped = 0;
  const W = (x: number) => ab.x + x;
  const H = (y: number) => ab.y + y;
  const exists = (id: string) => Boolean(findObject(doc.objects, id));

  for (const a of actions.slice(0, 300)) {
    try {
      switch (a.type) {
        case 'addShape': {
          const shape = String(a.shape ?? 'rect');
          const x = W(num(a.x, -1e5, 1e5, 0));
          const y = H(num(a.y, -1e5, 1e5, 0));
          const w = num(a.w ?? a.width, -1e5, 1e5, 100);
          const h = num(a.h ?? a.height, -1e5, 1e5, 100);
          const fill = color(a.fill) ?? core.style.fill;
          const strokePaint = color(a.stroke) ?? NONE;
          const stroke = defaultStroke(strokePaint, num(a.strokeWidth, 0, 500, strokePaint.type === 'none' ? 1 : 2));
          const style = { fill, stroke };
          const bw = Math.max(0.1, Math.abs(w));
          const bh = Math.max(0.1, Math.abs(h));
          const bx = Math.min(x, x + w);
          const by = Math.min(y, y + h);
          let o: VObject;
          if (shape === 'ellipse' || shape === 'circle') o = createEllipse(bx, by, bw, bh, style);
          else if (shape === 'polygon') o = createPolygon(bx, by, bw, bh, clampInt(a.sides, 3, 64, 6), style);
          else if (shape === 'star') o = createStar(bx, by, bw, bh, clampInt(a.points, 3, 64, 5), num(a.innerRadius, 0.05, 0.95, 0.5), style);
          else if (shape === 'line') o = createLine(x, y, x + w, y + h, { stroke: strokePaint.type === 'none' ? defaultStroke(fill.type === 'none' ? solid('#000000') : fill, stroke.width) : stroke });
          else o = createRect(bx, by, bw, bh, style, num(a.radius, 0, 1e5, 0));
          o = decorate(o, a);
          doc = insertObjects(doc, [o], null);
          created.push(o.id);
          done++;
          break;
        }
        case 'addPath': {
          const d = str(a.d, 50000);
          const geom = d ? parsePathData(d) : null;
          if (!geom || !geom.subpaths.length) {
            skipped++;
            break;
          }
          let o: VObject = createPath(geom, { fill: color(a.fill) ?? NONE, stroke: defaultStroke(color(a.stroke) ?? NONE, num(a.strokeWidth, 0, 500, 2)) }, str(a.name) || 'Path');
          o.m = translate(ab.x, ab.y);
          o = decorate(o, a);
          doc = insertObjects(doc, [o], null);
          created.push(o.id);
          done++;
          break;
        }
        case 'addText': {
          const text = str(a.text, 5000);
          if (!text) {
            skipped++;
            break;
          }
          const align = a.align === 'center' || a.align === 'right' ? a.align : 'left';
          const t = createText(0, 0, text, {
            fontFamily: str(a.font, 120) || core.options.fontFamily,
            fontSize: num(a.size ?? a.fontSize, 1, 1000, 36),
            fontWeight: clampInt(a.weight ?? a.fontWeight, 100, 900, 400),
            italic: a.italic === true,
            align,
          }, color(a.fill) ?? solid('#000000'));
          let o: VObject = t;
          o = decorate(o, a);
          doc = insertObjects(doc, [o], null);
          // place the top-left of the text box at (x, y)
          const f = getFrame(doc.objects, o.id);
          if (f) doc = { ...doc, objects: setFrame(doc.objects, o.id, { x: W(num(a.x, -1e5, 1e5, 0)), y: H(num(a.y, -1e5, 1e5, 0)) }) };
          created.push(o.id);
          done++;
          break;
        }
        case 'update': {
          const id = String(a.id ?? '');
          if (!exists(id)) {
            skipped++;
            break;
          }
          const p = (a.props && typeof a.props === 'object' ? a.props : a) as Record<string, unknown>;
          doc = { ...doc, objects: updateObject(doc.objects, id, p, ab.x, ab.y) };
          done++;
          break;
        }
        case 'delete': {
          const list = ids(a.ids ?? a.id).filter(exists);
          if (list.length) {
            doc = { ...doc, objects: removeByIds(doc.objects, list) };
            done++;
          } else skipped++;
          break;
        }
        case 'align': {
          const list = ids(a.ids ?? a.id).filter(exists);
          const mode = ALIGN[String(a.mode)];
          if (!list.length || !mode) {
            skipped++;
            break;
          }
          const target = a.to === 'artboard' || list.length === 1 ? { x: ab.x, y: ab.y, width: ab.width, height: ab.height } : null;
          doc = { ...doc, objects: alignByIds(doc.objects, list, mode, target) };
          done++;
          break;
        }
        case 'arrange': {
          const list = ids(a.ids ?? a.id).filter(exists);
          const mode = ARRANGE[String(a.mode)];
          if (!list.length || !mode) {
            skipped++;
            break;
          }
          doc = { ...doc, objects: arrangeByIds(doc.objects, list, mode) };
          done++;
          break;
        }
        case 'group': {
          const list = ids(a.ids).filter(exists);
          const r = list.length ? groupByIds(doc.objects, list, str(a.name) || 'Group') : null;
          if (r) {
            doc = { ...doc, objects: r.objects };
            created.push(r.groupId);
            done++;
          } else skipped++;
          break;
        }
        case 'recolor': {
          let mapping: Record<string, string> = {};
          if (a.mapping && typeof a.mapping === 'object') {
            for (const [k, v] of Object.entries(a.mapping as Record<string, unknown>)) if (typeof v === 'string') mapping[k] = v;
          } else if (Array.isArray(a.palette)) {
            mapping = paletteMapping(collectColors(doc.objects), a.palette.filter((c): c is string => typeof c === 'string'));
          }
          const r = recolorWithMapping(doc.objects, mapping);
          doc = { ...doc, objects: r.objects };
          done++;
          break;
        }
        case 'addSvg': {
          const markup = typeof a.svg === 'string' ? a.svg.slice(0, 500000) : '';
          const clean = markup ? sanitizeSvg(markup) : '';
          if (!clean) {
            skipped++;
            break;
          }
          const res = importSvg(clean);
          if (!res.objects.length) {
            skipped++;
            break;
          }
          const tw = a.w !== undefined ? num(a.w, 1, 1e5, res.width) : Math.min(ab.width * 0.8, (ab.height * 0.8 * res.width) / Math.max(1, res.height));
          const s = tw / Math.max(1, res.width);
          const x = a.x !== undefined ? W(num(a.x, -1e5, 1e5, 0)) : ab.x + (ab.width - res.width * s) / 2;
          const y = a.y !== undefined ? H(num(a.y, -1e5, 1e5, 0)) : ab.y + (ab.height - res.height * s) / 2;
          const g = createGroup(res.objects, str(a.name) || 'AI artwork');
          const placed = bakeScale({ ...g, m: chain(translate(x, y), scale(s)) });
          doc = insertObjects(doc, [placed], null);
          created.push(placed.id);
          done++;
          break;
        }
        case 'setArtboard': {
          const bg = a.background === undefined ? ab.background : a.background === null || a.background === 'transparent' || a.background === 'none' ? null : (normalizeColor(String(a.background)) ?? ab.background);
          const next = { ...ab, width: Math.round(num(a.width, 1, 20000, ab.width)), height: Math.round(num(a.height, 1, 20000, ab.height)), background: bg };
          doc = { ...doc, artboards: doc.artboards.map((x) => (x.id === ab.id ? next : x)) };
          ab = next;
          done++;
          break;
        }
        default:
          skipped++;
      }
    } catch {
      skipped++;
    }
  }
  if (doc !== core.doc) {
    const finalDoc = doc;
    core.update(() => finalDoc, 'AI edit');
    if (created.length) core.setSelection(created);
  }
  const parts = [tr('{count} change(s) applied', { count: done })];
  if (skipped) parts.push(tr('{count} skipped', { count: skipped }));
  return parts.join(', ');
}

function decorate(o: VObject, a: AIAction): VObject {
  let out = o;
  const name = str(a.name);
  if (name) out = { ...out, name };
  if (a.opacity !== undefined) out = { ...out, opacity: num(a.opacity, 0, 1, 1) };
  if (a.rotation !== undefined) {
    const deg = num(a.rotation, -3600, 3600, 0);
    if (deg) {
      const f = getFrame([out], out.id);
      if (f) out = setFrame([out], out.id, { rotation: deg })[0];
    }
  }
  return out;
}

function updateObject(objects: VObject[], id: string, p: Record<string, unknown>, ox: number, oy: number): VObject[] {
  let next = mapTree(objects, (o) => {
    if (o.id !== id) return o;
    let x: VObject = { ...o };
    const name = str(p.name);
    if (name) x.name = name;
    if (p.opacity !== undefined) x.opacity = num(p.opacity, 0, 1, x.opacity);
    if (typeof p.visible === 'boolean') x.visible = p.visible;
    if (typeof p.locked === 'boolean') x.locked = p.locked;
    if (typeof p.blend === 'string' && (BLEND_MODES as readonly string[]).includes(p.blend)) x.blend = p.blend as BlendMode;
    const fill = color(p.fill);
    const stroke = color(p.stroke);
    const apply = (leaf: VObject): VObject => {
      if (leaf.type === 'group') return { ...leaf, children: leaf.children.map(apply) };
      if (leaf.type === 'image' || leaf.type === 'raw') return leaf;
      let l = { ...leaf } as VObject;
      if (fill && l.type !== 'line') l.fill = fill;
      if (stroke) l.stroke = { ...l.stroke, paint: stroke, width: l.stroke.width || 1 };
      if (p.strokeWidth !== undefined) l.stroke = { ...l.stroke, width: num(p.strokeWidth, 0, 500, l.stroke.width) };
      if (l.type === 'text') {
        const text = str(p.text, 5000);
        if (text !== undefined) l = { ...l, text };
        if (p.size !== undefined || p.fontSize !== undefined) l = { ...l, fontSize: num(p.size ?? p.fontSize, 1, 1000, l.fontSize) };
        const font = str(p.font ?? p.fontFamily, 120);
        if (font) l = { ...l, fontFamily: font };
        if (p.weight !== undefined || p.fontWeight !== undefined) l = { ...l, fontWeight: clampInt(p.weight ?? p.fontWeight, 100, 900, l.fontWeight) };
        if (p.align === 'left' || p.align === 'center' || p.align === 'right') l = { ...l, align: p.align };
        if (typeof p.italic === 'boolean') l = { ...l, italic: p.italic };
      }
      if (l.type === 'rect' && p.radius !== undefined) l = { ...l, radius: num(p.radius, 0, 1e5, l.radius) };
      if (l.type === 'polygon' && p.sides !== undefined) l = { ...l, sides: clampInt(p.sides, 3, 64, l.sides) };
      if (l.type === 'star' && p.points !== undefined) l = { ...l, points: clampInt(p.points, 3, 64, l.points) };
      if (l.type === 'star' && p.innerRadius !== undefined) l = { ...l, inner: num(p.innerRadius, 0.05, 0.95, l.inner) };
      return l;
    };
    x = apply(x);
    if (p.shadow === null) x = { ...x, effects: { ...x.effects, shadow: undefined } };
    else if (p.shadow && typeof p.shadow === 'object') {
      const s = p.shadow as Record<string, unknown>;
      x = {
        ...x,
        effects: {
          ...x.effects,
          shadow: { x: num(s.x, -500, 500, 0), y: num(s.y, -500, 500, 6), blur: num(s.blur, 0, 500, 12), color: normalizeColor(String(s.color ?? '')) ?? 'rgba(0, 0, 0, 0.35)' },
        },
      };
    }
    if (p.blur !== undefined) {
      const b = num(p.blur, 0, 200, 0);
      x = { ...x, effects: { ...x.effects, blur: b > 0 ? b : undefined } };
    }
    return x;
  });
  const geo: Record<string, number> = {};
  if (p.x !== undefined) geo.x = num(p.x, -1e5, 1e5, 0) + ox;
  if (p.y !== undefined) geo.y = num(p.y, -1e5, 1e5, 0) + oy;
  if (p.w !== undefined || p.width !== undefined) geo.w = num(p.w ?? p.width, 0.1, 1e5, 1);
  if (p.h !== undefined || p.height !== undefined) geo.h = num(p.h ?? p.height, 0.1, 1e5, 1);
  if (p.rotation !== undefined) geo.rotation = num(p.rotation, -3600, 3600, 0);
  if (Object.keys(geo).length && worldMatrix(next, id)) next = setFrame(next, id, geo);
  return next;
}
