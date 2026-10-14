import { uid } from '../../../core/utils/id';
import type { Frame, LayoutDoc } from '../types';
import { DOC_TEMPLATES } from './docs';
import type { TemplateDef } from './kit';
import { PRINT_TEMPLATES } from './print';
import { SOCIAL_TEMPLATES } from './social';

export type { TemplateDef } from './kit';

export const TEMPLATES: TemplateDef[] = [
  PRINT_TEMPLATES[0], // event poster
  PRINT_TEMPLATES[1], // sale flyer
  SOCIAL_TEMPLATES[0], // instagram post
  SOCIAL_TEMPLATES[1], // instagram story
  SOCIAL_TEMPLATES[2], // youtube thumbnail
  PRINT_TEMPLATES[2], // business card
  DOC_TEMPLATES[0], // resume
  DOC_TEMPLATES[1], // newsletter
  PRINT_TEMPLATES[3], // invitation
  PRINT_TEMPLATES[4], // certificate
  PRINT_TEMPLATES[5], // menu
  SOCIAL_TEMPLATES[5], // presentation
  PRINT_TEMPLATES[6], // open house
  SOCIAL_TEMPLATES[3], // facebook cover
  SOCIAL_TEMPLATES[4], // linkedin banner
];

/** Names new documents start with; they show in the UI language until the user renames the document. */
export const DEFAULT_DOC_NAMES: readonly string[] = ['Untitled', ...TEMPLATES.map((def) => def.name)];

export function findTemplate(nameOrId: string): TemplateDef | undefined {
  const key = nameOrId.trim().toLowerCase();
  return (
    TEMPLATES.find((t) => t.id === key) ??
    TEMPLATES.find((t) => t.name.toLowerCase() === key) ??
    TEMPLATES.find((t) => t.id.includes(key.replace(/\s+/g, '-')) || t.name.toLowerCase().includes(key))
  );
}

/** Builds a template with fresh ids (so it can be used several times in one session). */
export function buildTemplate(def: TemplateDef): LayoutDoc {
  const doc = def.build();
  const idMap = new Map<string, string>();
  const remap = (f: Frame): Frame => {
    const id = uid('f');
    idMap.set(f.id, id);
    return { ...f, id };
  };
  const pages = doc.pages.map((p) => ({ ...p, id: uid('p'), frames: p.frames.map(remap) }));
  const master = { frames: doc.master.frames.map(remap) };
  const fixThread = (f: Frame): Frame => (f.type === 'text' && f.nextId ? { ...f, nextId: idMap.get(f.nextId) ?? null } : f);
  return {
    ...doc,
    id: uid('d'),
    pages: pages.map((p) => ({ ...p, frames: p.frames.map(fixThread) })),
    master: { frames: master.frames.map(fixThread) },
  };
}
