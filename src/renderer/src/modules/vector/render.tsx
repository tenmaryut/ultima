import { createElement, memo, type CSSProperties, type ReactNode } from 'react';
import type { Artboard, VObject } from './model';
import { objectToNode, type VChild } from './svgnode';
import { objectGeom } from './geometry';
import { serializePath, transformGeom } from './path';
import { multiply, type Matrix } from './matrix';

const camel = (k: string) => k.replace(/[-:]([a-z])/g, (_, c: string) => c.toUpperCase());

/** Converts a VNode into React elements (never sets raw HTML). */
export function vnodeToReact(node: VChild, key?: string | number): ReactNode {
  if (typeof node === 'string') return node;
  if ('raw' in node) return null;
  const props: Record<string, unknown> = { key };
  for (const [k, v] of Object.entries(node.attrs)) {
    if (v === undefined || k === 'xlink:href') continue;
    props[k === 'class' ? 'className' : camel(k)] = v;
  }
  if (node.style) {
    const style: Record<string, string> = {};
    for (const [k, v] of Object.entries(node.style)) style[camel(k)] = v;
    props.style = style as CSSProperties;
  }
  const children = node.children?.map((c, i) => vnodeToReact(c, i));
  return createElement(node.tag, props, ...(children ?? []));
}

/** One document object, re-rendered only when the object (immutable) changes. */
export const ObjectView = memo(function ObjectView({ o, prefix, hidden }: { o: VObject; prefix: string; hidden: string | null }) {
  const node = objectToNode(o, { idPrefix: prefix, hidden: hidden ? new Set([hidden]) : undefined });
  return node ? <>{vnodeToReact(node)}</> : null;
});

/** Outline (wireframe) rendering of one object. */
export const OutlineView = memo(function OutlineView({ o, m, zoom }: { o: VObject; m: Matrix; zoom: number }) {
  if (!o.visible) return null;
  const wm = multiply(m, o.m);
  if (o.type === 'group') {
    return (
      <>
        {o.children.map((c) => (
          <OutlineView key={c.id} o={c} m={wm} zoom={zoom} />
        ))}
      </>
    );
  }
  const g = objectGeom(o);
  if (!g) return null;
  return <path d={serializePath(transformGeom(g, wm), 2)} fill="none" stroke="currentColor" strokeWidth={1 / zoom} />;
});

export const DocObjects = memo(function DocObjects({
  objects,
  prefix,
  hidden,
  outline,
  zoom,
}: {
  objects: VObject[];
  prefix: string;
  hidden: string | null;
  outline: boolean;
  zoom: number;
}) {
  if (outline) {
    return (
      <g className="vc-outline-mode">
        {objects.map((o) => (
          <OutlineView key={o.id} o={o} m={[1, 0, 0, 1, 0, 0]} zoom={zoom} />
        ))}
      </g>
    );
  }
  return (
    <>
      {objects.map((o) => (
        <ObjectView key={o.id} o={o} prefix={prefix} hidden={hidden} />
      ))}
    </>
  );
});

export const ArtboardLayer = memo(function ArtboardLayer({ artboards, zoom }: { artboards: Artboard[]; zoom: number }) {
  return (
    <>
      {artboards.map((ab) => (
        <g key={ab.id}>
          <rect
            x={ab.x}
            y={ab.y}
            width={ab.width}
            height={ab.height}
            fill={ab.background ?? 'url(#vc-checker)'}
            className="vc-artboard"
            style={{ filter: zoom > 0.05 ? 'drop-shadow(0 1px 4px rgba(0,0,0,0.35))' : undefined }}
          />
        </g>
      ))}
    </>
  );
});
