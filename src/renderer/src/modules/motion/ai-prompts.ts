import { isAnimated } from './keyframes';
import { getProp, propsForLayer, PROP_DEFS } from './model';
import { PRESETS } from './presets';
import type { AnimProp, Keyframe, Layer, MotionDoc, PropValue } from './types';

/** Prompts for the Motion Graphics AI features (pure text builders). */

const PRESET_LIST = PRESETS.map((p) => p.id).join(', ');

export const LAYER_PROPS_DOC = `LAYER PROPS (all optional; units in brackets)
- name: string
- text (text layers): string, "\\n" for new lines; fontFamily: string; fontSize [px]; fontWeight: 100-900; italic: boolean;
  align: "left"|"center"|"right"; lineHeight [× font size, 0.5-5]; letterSpacing [px]
- shape (shape layers): "rect"|"ellipse"|"polygon"|"star"|"line"|"path"; path: SVG path data (e.g. "M0 0 L100 0 C ...")
  in composition pixels; points (polygon sides / star points, 3-100); innerRadius (star, % of outer radius); cornerRadius [px]
- width, height [px] (shape/solid size; for a line, width is its length)
- fill (or color): CSS color, or "none" to disable the fill; stroke: CSS color or "none"; strokeWidth [px]
- x, y or position: [x, y] [composition px] — where the layer's center (anchor point) sits; parented layers: relative to the parent
- anchor: [x, y] [px offset of the pivot from the layer center]; scale: number or [sx, sy] [%, 100 = original];
  rotation [degrees, clockwise]; opacity [0-100]
- inPoint, outPoint [seconds] — when the layer is visible
- blendMode: normal|multiply|screen|overlay|add|darken|lighten|color-dodge|color-burn|hard-light|soft-light|difference|exclusion|hue|saturation|color|luminosity
- blur [px]; shadow: true | false | {color, angle (deg, 90 = down), distance [px], softness [px]}; glow: true | false | {color, radius [px], intensity [0-300 %]}
- trimStart, trimEnd [0-100 %] (shape outline reveal); reveal [0-100 %] (text reveal); revealMode: "chars"|"words"|"lines"; revealStyle: "instant"|"fade"|"rise"
- parentId: id of another layer (child follows the parent's position/scale/rotation); visible, locked, solo: boolean`;

export const EASING_DOC = `EASINGS: "linear", "easeIn", "easeOut", "easeInOut", "hold" (jump at the next key), "back" (overshoot), "elastic", "bounce",
or a custom curve "cubic-bezier(x1, y1, x2, y2)". The easing on a keyframe shapes the motion FROM that keyframe TO the next one.`;

export const MOTION_AI_INSTRUCTIONS = `You animate a motion-graphics composition (like After Effects). Coordinates are composition pixels with (0,0) at the top-left.
Times are in seconds from the start of the composition. Layers are listed top-most first in the context.

ACTIONS
1. {"type":"setComposition", "width"?: px 16-8192, "height"?: px, "duration"?: s 0.1-3600, "fps"?: 1-120, "background"?: CSS color | "transparent", "name"?: string}
2. {"type":"addLayer", "id"?: "short_id", "layerType": "text"|"rect"|"ellipse"|"polygon"|"star"|"line"|"path"|"solid"|"null", "props": {LAYER PROPS}}
   New layers go on top. Give an "id" when later actions in the same reply refer to the new layer.
3. {"type":"setProps", "layerId": id, "props": {LAYER PROPS}} — if a property is animated, the value is keyed at the current time.
4. {"type":"addKeyframes", "layerId": id, "property": "position"|"scale"|"rotation"|"opacity"|"anchor"|"size"|"fill"|"strokeColor"|"strokeWidth"|"cornerRadius"|"trimStart"|"trimEnd"|"letterSpacing"|"reveal"|"blur",
   "keyframes": [{"time": s, "value": number | [x, y] | "#rrggbb", "easing": EASING}], "replace"?: true to remove the property's existing keyframes first}
   position/anchor/size values are [x, y]; scale is [sx, sy] in %; opacity 0-100; rotation in degrees.
5. {"type":"applyPreset", "layerId": id, "preset": one of ${PRESET_LIST}, "time"?: start s (default: current time), "duration"?: s, "frequency"?: Hz (wiggle), "amplitude"?: px (wiggle)}
6. {"type":"deleteLayer", "layerId": id}
7. {"type":"setEasing", "layerId": id, "property"?: property name or "all", "easing": EASING} — changes the easing of existing keyframes.
8. {"type":"clearKeyframes", "layerId": id, "property"?: property name or "all"} — removes the animation, keeping the current value.

${LAYER_PROPS_DOC}

${EASING_DOC}

GUIDELINES
- Keep motion readable: entrances 0.4-1.2 s, stagger related elements by 0.1-0.3 s, hold important text ≥ 1 s.
- Prefer presets for standard moves (fadeIn, slideInLeft, popIn, bounceIn, typewriter, wordReveal, drawOn, wiggle…); use addKeyframes for custom motion.
- Keep layers inside the frame unless they are entering/leaving. Use readable font sizes (≥ 4% of the composition height for titles).

EXAMPLES
User: "Make the title pop in at 0.5s and fade out at the end"
{"message":"The title now pops in and fades out.","actions":[{"type":"applyPreset","layerId":"L1","preset":"popIn","time":0.5,"duration":0.5},{"type":"applyPreset","layerId":"L1","preset":"fadeOut","time":4.4,"duration":0.6}]}
User: "Add a yellow circle that moves from left to right"
{"message":"Added a circle moving across the frame.","actions":[{"type":"addLayer","id":"dot","layerType":"ellipse","props":{"width":120,"height":120,"fill":"#facc15","x":200,"y":540}},{"type":"addKeyframes","layerId":"dot","property":"position","keyframes":[{"time":0,"value":[200,540],"easing":"easeInOut"},{"time":2,"value":[1720,540]}]}]}`;

function fmtValue(v: PropValue): string {
  if (Array.isArray(v)) return `[${v.map((n) => Math.round(n * 10) / 10).join(', ')}]`;
  if (typeof v === 'number') return String(Math.round(v * 100) / 100);
  return v;
}

function keySummary(prop: AnimProp, max = 8): string {
  const keys = prop.keyframes as Keyframe[];
  const shown = keys.slice(0, max).map((k) => `${Math.round(k.time * 100) / 100}s=${fmtValue(k.value)} (${k.easing === 'bezier' ? `cubic-bezier(${k.bezier?.join(',')})` : k.easing})`);
  return shown.join(', ') + (keys.length > max ? `, … ${keys.length - max} more` : '');
}

/** One line per layer property that matters to the AI. */
export function describeLayer(layer: Layer, bounds?: { x: number; y: number; w: number; h: number }): string {
  const lines: string[] = [];
  let kind: string = layer.type;
  if (layer.type === 'shape') kind = `shape:${layer.shape?.kind}`;
  lines.push(
    `- id=${layer.id} "${layer.name}" (${kind})${layer.parentId ? ` parent=${layer.parentId}` : ''}${layer.visible ? '' : ' hidden'}${layer.solo ? ' solo' : ''}${layer.locked ? ' locked' : ''} in=${round(layer.inPoint)}s out=${round(layer.outPoint)}s`,
  );
  if (layer.type === 'text' && layer.text) {
    const t = layer.text;
    lines.push(`  text=${JSON.stringify(t.text.slice(0, 200))} font="${t.fontFamily}" ${t.fontSize}px weight=${t.fontWeight} align=${t.align}`);
  }
  const statics = propsForLayer(layer)
    .filter((k) => !isAnimated(getProp(layer, k)))
    .map((k) => `${k}=${fmtValue(getProp(layer, k).value)}`);
  lines.push(`  ${statics.join(' ')}`);
  if (bounds) lines.push(`  bounds≈ x=${round(bounds.x)} y=${round(bounds.y)} w=${round(bounds.w)} h=${round(bounds.h)}`);
  for (const k of propsForLayer(layer)) {
    const prop = getProp(layer, k);
    if (isAnimated(prop)) lines.push(`  ${k} keys: ${keySummary(prop)}`);
  }
  if (layer.wiggles.length) {
    lines.push(`  wiggles: ${layer.wiggles.map((w) => `${w.property} ${w.frequency}Hz ±${w.amplitude} ${round(w.start)}-${round(w.end)}s`).join('; ')}`);
  }
  const fx: string[] = [];
  if (layer.effects.shadow.enabled) fx.push('drop shadow');
  if (layer.effects.glow.enabled) fx.push('glow');
  if (layer.blendMode !== 'normal') fx.push(`blend ${layer.blendMode}`);
  if (fx.length) lines.push(`  effects: ${fx.join(', ')}`);
  return lines.join('\n');
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Plain-text summary of the document for the assistant. */
export function describeDocument(
  doc: MotionDoc,
  time: number,
  selection: string[],
  boundsOf?: (layer: Layer) => { x: number; y: number; w: number; h: number } | undefined,
): string {
  const c = doc.comp;
  const head = [
    `COMPOSITION "${c.name}": ${c.width}×${c.height}px, ${c.fps} fps, duration ${c.duration}s, background ${c.transparent ? 'transparent' : c.background}`,
    `Current time: ${round(time)}s. Work area ${round(c.workStart)}-${round(c.workEnd)}s.`,
    `Selected layers: ${selection.length ? selection.join(', ') : 'none'}`,
    `LAYERS (${doc.layers.length}, top-most first):`,
  ];
  const max = 60;
  const body = doc.layers.slice(0, max).map((l) => describeLayer(l, boundsOf?.(l)));
  if (doc.layers.length > max) body.push(`… ${doc.layers.length - max} more layers`);
  if (!doc.layers.length) body.push('(no layers yet)');
  return [...head, ...body].join('\n');
}

export const SCENE_SYSTEM = `You are a motion designer. Turn the user's description into an animated scene for a motion-graphics editor.
Return ONE JSON object:
{
  "message": "one short sentence about the result",
  "composition": {"width": px, "height": px, "duration": s, "fps": 24-60, "background": "#rrggbb" or "transparent"},   (optional — only if the description implies a format or length)
  "layers": [   (listed BOTTOM to TOP: later layers are drawn in front)
    {"id": "short_id", "layerType": "text"|"rect"|"ellipse"|"polygon"|"star"|"line"|"path"|"solid"|"null",
     "props": {LAYER PROPS},
     "keyframes": {"<property>": [{"time": s, "value": ..., "easing": EASING}, ...], ...},
     "presets": [{"preset": "<preset id>", "time": s, "duration": s}]}
  ]
}
Properties for keyframes: position [x,y], scale [sx,sy] (%), rotation (deg), opacity (0-100), anchor [x,y], size [w,h], fill (color), strokeColor, strokeWidth, cornerRadius, trimStart/trimEnd (0-100), letterSpacing (px), reveal (0-100), blur (px).
Presets: ${PRESET_LIST}.

${LAYER_PROPS_DOC}

${EASING_DOC}

RULES
- Use real numbers only (no expressions). Coordinates are composition pixels, (0,0) top-left; x/y is the CENTER of a layer.
- Every keyframe time must be within the composition duration. Keep everything readable and inside the frame at rest.
- For bursts/confetti use several small ellipse/rect/star layers (max ~24) with staggered position/scale/opacity keyframes.
- Use at most 40 layers. Prefer bold, high-contrast colors and readable font sizes.`;

export function scenePrompt(description: string, doc: MotionDoc, keepExisting: boolean): string {
  const c = doc.comp;
  return [
    `CURRENT COMPOSITION: ${c.width}×${c.height}px, ${c.fps} fps, ${c.duration}s, background ${c.transparent ? 'transparent' : c.background}.`,
    keepExisting && doc.layers.length
      ? `Existing layers (keep them; add new ones that fit): ${doc.layers.map((l) => `"${l.name}" (${l.type})`).join(', ')}`
      : 'The composition is empty: build the whole scene.',
    `DESCRIPTION\n${description.trim()}`,
  ].join('\n\n');
}

export const SUGGEST_SYSTEM = `You are a senior motion designer reviewing the timing and easing of ONE layer of an animation.
Suggest better easing and timing following animation principles (ease out for entrances, ease in for exits, overshoot for playful pops, holds for readability, natural staggering).
Return ONE JSON object: {"message": "markdown-free explanation, max 5 short bullet-like sentences", "actions": [ ... ]}
Allowed actions (only for the given layer id):
- {"type":"setEasing","layerId": id, "property": name or "all", "easing": EASING}
- {"type":"addKeyframes","layerId": id, "property": name, "replace": true, "keyframes":[{"time": s, "value": ..., "easing": EASING}]}  (to retime: rewrite ALL keyframes of that property with the same values at better times)
${EASING_DOC}
Return "actions": [] if the animation is already good.`;

export function suggestPrompt(doc: MotionDoc, layer: Layer): string {
  const c = doc.comp;
  const animated = Object.keys(PROP_DEFS)
    .map((k) => [k, getProp(layer, k as keyof typeof PROP_DEFS)] as const)
    .filter(([, p]) => isAnimated(p))
    .map(([k, p]) => `${k}: ${JSON.stringify(p.keyframes.map((kf) => ({ time: round(kf.time), value: kf.value, easing: kf.easing === 'bezier' ? `cubic-bezier(${kf.bezier?.join(',')})` : kf.easing })))}`);
  return [
    `Composition: ${c.width}×${c.height}, ${c.fps} fps, ${c.duration}s.`,
    `Layer id=${layer.id} "${layer.name}" (${layer.type}), visible ${round(layer.inPoint)}-${round(layer.outPoint)}s.`,
    animated.length ? `Keyframes:\n${animated.join('\n')}` : 'The layer has no keyframes yet: suggest a tasteful entrance using addKeyframes.',
    layer.wiggles.length ? `Wiggles: ${JSON.stringify(layer.wiggles)}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}
