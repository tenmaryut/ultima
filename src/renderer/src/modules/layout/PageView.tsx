import { createElement, memo, type CSSProperties, type ReactNode } from 'react';
import { dataUrlToBlob } from '../../core/utils/base64';
import type { ImageAsset, LayoutDoc, Page } from './types';
import { pageNode, type Child, type FlowMap } from './vnode';

/** Converts the renderer's VNode tree into React elements (text stays text). */
const ATTR_MAP: Record<string, string> = {
  class: 'className',
  'stroke-width': 'strokeWidth',
  'stroke-linejoin': 'strokeLinejoin',
  'stroke-dasharray': 'strokeDasharray',
  'stop-color': 'stopColor',
  'stop-opacity': 'stopOpacity',
};

export function toReact(node: Child, key?: number): ReactNode {
  if (typeof node === 'string') return node;
  const props: Record<string, unknown> = { key };
  for (const [k, v] of Object.entries(node.attrs ?? {})) {
    if (/^on/i.test(k)) continue;
    props[ATTR_MAP[k] ?? k] = v;
  }
  if (node.style) props.style = node.style as CSSProperties;
  if (node.tag === 'img') props.draggable = false;
  const children = node.children?.map((c, i) => toReact(c, i));
  return createElement(node.tag, props, ...(children ?? []));
}

/* ------------------------- Object URLs for image assets ------------------------- */

const urlCache = new Map<string, { src: string; url: string }>();

/** Editor display URL for an asset (object URL decoded once from the data URL). */
export function assetDisplayUrl(asset: ImageAsset): string {
  const cached = urlCache.get(asset.id);
  if (cached && cached.src === asset.src) return cached.url;
  if (cached) URL.revokeObjectURL(cached.url);
  try {
    const url = URL.createObjectURL(dataUrlToBlob(asset.src));
    urlCache.set(asset.id, { src: asset.src, url });
    return url;
  } catch {
    return asset.src;
  }
}

/** Frees object URLs of assets that are no longer in the document. */
export function releaseAssetUrls(keep: Record<string, ImageAsset>): void {
  for (const [id, entry] of urlCache) {
    if (!keep[id]) {
      URL.revokeObjectURL(entry.url);
      urlCache.delete(id);
    }
  }
}

/* --------------------------------- Page view --------------------------------- */

export interface PageViewProps {
  doc: LayoutDoc;
  page: Page;
  pageIndex: number;
  flows?: FlowMap;
  bleed?: number;
  hideContent?: ReadonlySet<string>;
  editor?: boolean;
  idPrefix: string;
  /** Scale (CSS transform) for thumbnails. */
  scale?: number;
  className?: string;
  style?: CSSProperties;
}

function PageViewImpl(props: PageViewProps) {
  const node = pageNode({
    doc: props.doc,
    page: props.page,
    pageIndex: props.pageIndex,
    flows: props.flows,
    assetSrc: assetDisplayUrl,
    bleed: props.bleed ?? 0,
    withMaster: true,
    hideContent: props.hideContent,
    editor: props.editor,
    idPrefix: props.idPrefix,
  });
  const style: CSSProperties = { ...(node.style as CSSProperties), ...props.style };
  if (props.scale !== undefined && props.scale !== 1) {
    style.transform = `scale(${props.scale})`;
    style.transformOrigin = '0 0';
  }
  return (
    <div className={props.className} style={style}>
      {node.children?.map((c, i) => toReact(c, i))}
    </div>
  );
}

/** Re-renders only when something that affects this page changed. */
function samePage(a: PageViewProps, b: PageViewProps): boolean {
  if (
    a.page !== b.page ||
    a.pageIndex !== b.pageIndex ||
    a.bleed !== b.bleed ||
    a.hideContent !== b.hideContent ||
    a.scale !== b.scale ||
    a.editor !== b.editor ||
    a.style !== b.style
  ) {
    return false;
  }
  const da = a.doc;
  const db = b.doc;
  if (da.styles !== db.styles || da.swatches !== db.swatches || da.assets !== db.assets || da.master !== db.master) return false;
  if (da.pages.length !== db.pages.length || da.facing !== db.facing || da.mirrorMaster !== db.mirrorMaster) return false;
  if (a.flows !== b.flows) {
    for (const f of b.page.frames) if (f.type === 'text' && a.flows?.get(f.id) !== b.flows?.get(f.id)) return false;
  }
  return true;
}

export const PageView = memo(PageViewImpl, samePage);
