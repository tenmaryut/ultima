import { resolveTextStyle, primaryFont, THEME_ROLES } from './styles';
import { TEMPLATES } from './templates';
import type { Frame, LayoutDoc } from './types';
import type { FlowMap } from './vnode';
import { PAGE_PRESETS, describeSize, getPreset } from './units';

/** Prompts and document descriptions for the Layout AI features. */

const r = (n: number) => Math.round(n * 10) / 10;

export const LAYOUT_AI_INSTRUCTIONS = `You edit page layouts (posters, flyers, social posts, documents, slides) in a page-layout editor.
All coordinates and sizes are in px of the page (96 px = 1 inch), origin at the top-left corner of the page. Pages are numbered from 1.
Colors are "#rrggbb" or theme references "$0".."$5" ($0 text, $1 background, $2 primary, $3 secondary, $4 neutral, $5 highlight). Prefer theme references so the design follows the theme.
Paragraph styles: use the ids listed in the document (title, subtitle, h1, h2, body, caption, quote, label).

ACTIONS (fields marked ? are optional; "page" defaults to the current page):
- {"type":"addText","page"?:n,"x","y","w","h","text":string (use \\n for new paragraphs),"style"?:styleId,"fontSize"?:px,"fontFamily"?:name,"fontWeight"?:100-900,"italic"?:bool,"uppercase"?:bool,"color"?,"align"?:"left"|"center"|"right"|"justify","lineHeight"?:0.6-4,"letterSpacing"?:-200..1500 (1/1000 em),"vAlign"?:"top"|"middle"|"bottom","fill"?:background color,"padding"?:px,"rotation"?:deg,"opacity"?:0-1}
- {"type":"addShape","page"?,"shape":"rect"|"ellipse"|"line"|"triangle"|"diamond"|"star","x","y","w","h","fill"?,"gradient"?:{"angle":deg,"colors":[color,color,...]},"stroke"?,"strokeWidth"?,"radius"?:px corner radius,"rotation"?,"opacity"?} (a line is horizontal across w; use rotation for other angles)
- {"type":"addImageFrame","page"?,"x","y","w","h","placeholderColor"?,"radius"?} (an empty frame the user fills with a photo later)
- {"type":"update","id":frameId,"props":{any of: x,y,w,h,rotation,opacity,locked,hidden,name,text,style,fontSize,fontFamily,fontWeight,italic,underline,uppercase,color,align,lineHeight,letterSpacing,fill,stroke,strokeWidth,radius,gradient,vAlign,padding,columns,fit:"fill"|"fit"|"stretch"|"none",placeholderColor,grayscale}}
- {"type":"rewriteText","id":frameId,"text":string}
- {"type":"delete","ids":[frameId,...]}
- {"type":"reorder","id":frameId,"to":"front"|"forward"|"backward"|"back"}
- {"type":"addPage","size"?:presetId or {"width","height","unit":"px"|"mm"|"in"|"pt"},"after"?:pageNumber,"background"?}
- {"type":"setPageSize","page"?:n or "all","preset"?:presetId,"width"?,"height"?,"unit"?,"orientation"?:"portrait"|"landscape","scaleContent"?:bool}
- {"type":"setBackground","page"?,"color","gradient"?:{"angle","colors":[...]}}
- {"type":"applyTemplate","name":templateName} (replaces the whole document)
- {"type":"setTheme","colors":[text,background,primary,secondary,neutral,highlight]} (recolors everything that uses theme references)
- {"type":"updateStyle","style":styleId,"props":{fontSize,fontFamily,fontWeight,color,align,lineHeight,letterSpacing,italic,uppercase}} (updates every frame using that paragraph style)

Page size presets: ${PAGE_PRESETS.map((p) => p.id).join(', ')}.
Templates: ${TEMPLATES.map((t) => t.name).join(', ')}.

GOOD DESIGN: keep text inside the page margins, align elements to a grid, use generous whitespace, 2 fonts at most, strong size contrast between headline and body, enough color contrast, and do not overlap text with other text.

EXAMPLES
User: "Add a big headline at the top" →
{"message":"Added a headline.","actions":[{"type":"addText","x":80,"y":80,"w":920,"h":160,"text":"Summer Sale","style":"title","fontSize":120,"align":"center","color":"$2"}]}
User: "Make the background dark blue and the title white" (title id f1) →
{"message":"Done.","actions":[{"type":"setBackground","color":"#0b1d3a"},{"type":"update","id":"f1","props":{"color":"#ffffff"}}]}`;

function frameLine(doc: LayoutDoc, f: Frame, flows?: FlowMap): string {
  const rect = `x=${r(f.x)} y=${r(f.y)} w=${r(f.w)} h=${r(f.h)}${f.rotation ? ` rot=${r(f.rotation)}` : ''}${f.opacity < 1 ? ` opacity=${r(f.opacity)}` : ''}`;
  const flags = [f.locked && 'locked', f.hidden && 'hidden', f.name && `name="${f.name}"`].filter(Boolean).join(' ');
  switch (f.type) {
    case 'text': {
      const s = resolveTextStyle(f, doc.styles);
      const text = f.text.length > 160 ? `${f.text.slice(0, 160)}…` : f.text;
      const flow = flows?.get(f.id);
      return `- ${f.id} TEXT ${rect} style=${f.styleId ?? 'none'} ${r(s.fontSize)}px ${s.fontWeight} "${primaryFont(s.fontFamily)}"${s.italic ? ' italic' : ''} color=${s.color} align=${s.align}${f.fill ? ` fill=${f.fill}` : ''}${f.nextId ? ` threadNext=${f.nextId}` : ''}${flow?.overflow ? ' [TEXT OVERFLOWS]' : ''} ${flags} text=${JSON.stringify(text)}`;
    }
    case 'image': {
      const a = f.assetId ? doc.assets[f.assetId] : undefined;
      return `- ${f.id} IMAGE ${rect} ${a ? `photo ${a.width}x${a.height}px fit=${f.fit}` : `empty placeholder color=${f.placeholder}`}${f.radius ? ` radius=${r(f.radius)}` : ''} ${flags}`;
    }
    case 'shape':
      return `- ${f.id} SHAPE ${f.shape} ${rect} fill=${f.fill || 'none'}${f.gradient ? ` gradient(${f.gradient.stops.map((s) => s.color).join('→')})` : ''}${f.stroke ? ` stroke=${f.stroke}/${r(f.strokeWidth)}` : ''}${f.radius ? ` radius=${r(f.radius)}` : ''} ${flags}`;
    case 'table':
      return `- ${f.id} TABLE ${rect} ${f.rows}x${f.cols} first row: ${JSON.stringify(f.cells[0]?.join(' | ').slice(0, 100) ?? '')} ${flags}`;
  }
}

/** Plain-text summary of the document for the AI assistant. */
export function describeDocument(doc: LayoutDoc, current: number, selection: string[], flows?: FlowMap, editingMaster = false): string {
  const lines: string[] = [];
  lines.push(`Document "${doc.name}": ${doc.pages.length} page(s), display unit ${doc.unit}${doc.facing ? ', facing pages' : ''}${doc.bleed ? `, bleed ${r(doc.bleed)}px` : ''}.`);
  lines.push(`Theme colors: ${doc.swatches.map((c, i) => `$${i}=${c}${THEME_ROLES[i] ? ` (${THEME_ROLES[i]})` : ''}`).join(', ')}`);
  lines.push(
    `Paragraph styles: ${doc.styles
      .map((s) => `${s.id} ("${s.name}" ${r(s.style.fontSize)}px ${s.style.fontWeight} ${primaryFont(s.style.fontFamily)})`)
      .join(', ')}`,
  );
  doc.pages.forEach((p, i) => {
    const preset = getPreset(p.preset);
    lines.push(
      `Page ${i + 1}${i === current ? ' (CURRENT)' : ''}: ${r(p.width)}x${r(p.height)}px (${describeSize(p.width, p.height, doc.unit)}${preset ? `, ${preset.name}` : ''}), margins ${r(p.margins.top)}/${r(p.margins.right)}/${r(p.margins.bottom)}/${r(p.margins.left)}, background ${p.background || 'none'}${p.gradient ? ` gradient(${p.gradient.stops.map((s) => s.color).join('→')})` : ''}, ${p.frames.length} frame(s)`,
    );
  });
  const page = doc.pages[current];
  if (page) {
    lines.push(`\nFrames on page ${current + 1}, bottom to top:`);
    if (!page.frames.length) lines.push('(no frames)');
    const max = 120;
    page.frames.slice(-max).forEach((f) => lines.push(frameLine(doc, f, flows)));
  }
  if (doc.master.frames.length) {
    lines.push('\nMaster page items (repeated on every page):');
    doc.master.frames.slice(0, 30).forEach((f) => lines.push(frameLine(doc, f)));
  }
  if (editingMaster) lines.push('\nThe user is editing the master page.');
  lines.push(selection.length ? `\nSelected frame ids: ${selection.join(', ')}` : '\nNothing is selected.');
  return lines.join('\n');
}

/* ---------------------------- Design from a brief ---------------------------- */

export const BRIEF_SYSTEM = `You are an expert graphic designer. You design ONE page for a page-layout editor and answer with JSON only.
JSON format:
{
  "size": presetId or {"width":px,"height":px},
  "theme": ["#text","#background","#primary","#secondary","#neutral","#highlight"],
  "background": "$1" or "#rrggbb",
  "backgroundGradient"?: {"angle":deg,"colors":["$2","$3"]},
  "frames": [
    {"type":"shape","shape":"rect"|"ellipse"|"line"|"triangle"|"diamond"|"star","x","y","w","h","fill"?,"gradient"?:{"angle","colors":[...]},"stroke"?,"strokeWidth"?,"radius"?,"rotation"?,"opacity"?},
    {"type":"image","x","y","w","h","placeholderColor"?,"radius"?},
    {"type":"text","x","y","w","h","text","style"?:"title"|"subtitle"|"h1"|"h2"|"body"|"caption"|"quote"|"label","fontSize":px,"fontWeight"?:100-900,"fontFamily"?,"italic"?,"uppercase"?,"color"?,"align"?:"left"|"center"|"right","lineHeight"?,"letterSpacing"?:1/1000 em,"vAlign"?}
  ]
}
Rules: coordinates in px of the page (origin top-left, 96 px = 1 in). Frames are drawn in order (first = bottom). Use theme references "$0".."$5" for colors. Text boxes must be large enough for their text (height ≥ lines × fontSize × lineHeight). Keep important content inside a margin of about 6% of the page. Write real, specific copy from the brief — no lorem ipsum. Use image frames as placeholders for photos. Use only widely available fonts (Inter, Arial, Georgia, Times New Roman, Helvetica, Verdana, Trebuchet MS, Courier New) or omit fontFamily.
Page size presets: ${PAGE_PRESETS.map((p) => `${p.id} (${p.name})`).join(', ')}.`;

export function briefPrompt(brief: string, sizeHint: string | null): string {
  return `Design brief:\n${brief.trim()}\n\n${sizeHint ? `Page size: ${sizeHint} (use exactly this size).` : 'Choose the most suitable page size preset.'}\n\nReturn the page JSON.`;
}

/* ------------------------------- Rewrite text ------------------------------- */

export type RewriteMode = 'shorten' | 'formal' | 'catchy' | 'translate' | 'grammar' | 'expand';

export const REWRITE_SYSTEM =
  'You are a professional copywriter and editor. Rewrite the text you are given as instructed. Answer with the rewritten text only — no quotes, no explanations, no markdown. Keep line breaks between paragraphs where they make sense. Keep {page} and {pages} tokens unchanged.';

export function rewritePrompt(mode: RewriteMode, text: string): string {
  const task: Record<RewriteMode, string> = {
    shorten: 'Make this text noticeably shorter (about half the length) while keeping the key message.',
    formal: 'Rewrite this text in a formal, professional tone.',
    catchy: 'Rewrite this text to be catchy, punchy and memorable, suitable for marketing.',
    translate:
      'Translate this text. If it is in Indonesian, translate it to English; otherwise translate it to Indonesian (Bahasa Indonesia). Keep the tone.',
    grammar: 'Fix spelling, grammar and punctuation. Do not change the meaning or the tone.',
    expand: 'Expand this text with a bit more helpful detail (about 1.5 times the length), same tone.',
  };
  return `${task[mode]}\n\nTEXT:\n${text}`;
}

/** Cleans a plain-text AI answer (strips code fences / wrapping quotes). */
export function cleanAIText(answer: string): string {
  let s = answer.trim();
  const fence = /^```[a-zA-Z]*\n([\s\S]*?)\n?```$/.exec(s);
  if (fence) s = fence[1].trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith('“') && s.endsWith('”'))) s = s.slice(1, -1).trim();
  return s;
}

/* ------------------------------- Generate copy ------------------------------ */

export const COPY_SYSTEM =
  'You are a senior copywriter. You write short, specific, persuasive copy for flyers, posters, social posts and documents. Answer with JSON only.';

export function copyPrompt(topic: string, tone: string, length: string, language: string): string {
  return `Write copy about: ${topic.trim()}\nTone: ${tone}. Length of the body: ${length}. Language: ${language}.\nReturn JSON: {"headline": string (max 8 words), "subheadline": string (one sentence), "body": string (paragraphs separated by \\n), "cta": string (2-4 words call to action)}`;
}

export interface CopyResult {
  headline: string;
  subheadline: string;
  body: string;
  cta: string;
}

export function validateCopy(raw: unknown): CopyResult | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const v = raw as Record<string, unknown>;
  const s = (x: unknown, max: number) => (typeof x === 'string' ? x.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max) : '');
  const out = { headline: s(v.headline ?? v.title, 300), subheadline: s(v.subheadline ?? v.subtitle, 600), body: s(v.body ?? v.text, 5000), cta: s(v.cta, 80) };
  return out.headline || out.body ? out : null;
}
