/**
 * In-app drag & drop payload (media bin / title presets -> timeline). HTML5 drag events only
 * expose data on drop, so the timeline reads what is being dragged from here for its ghost.
 */
export type DragPayload = { kind: 'media'; mediaId: string; duration: number } | { kind: 'title'; presetId: string; duration: number };

export const DND_MIME = 'application/x-ultima-video';

let current: DragPayload | null = null;

export function setDragPayload(p: DragPayload | null): void {
  current = p;
}

export function getDragPayload(): DragPayload | null {
  return current;
}
