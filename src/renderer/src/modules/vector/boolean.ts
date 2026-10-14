/*
 * Polygon boolean operations (union, intersection, difference, xor) using the
 * Martinez–Rueda–Feito sweep line algorithm ("A simple algorithm for Boolean operations
 * on polygons", 2013). It handles self-intersections, holes, overlapping and shared
 * edges, which are very common in vector artwork (snapped shapes share edges).
 *
 * Polygons are interpreted with the even-odd rule. Output rings never cross each other;
 * holes are reported in `holes` and are also valid with fill-rule="evenodd".
 */

export type P = [number, number];
export type Ring = P[];
/** A polygon: outer ring followed by holes (orientation does not matter). */
export type Polygon = Ring[];
export type MultiPolygon = Polygon[];
export type BoolOp = 'union' | 'intersection' | 'difference' | 'xor';

const NORMAL = 0;
const NON_CONTRIBUTING = 1;
const SAME_TRANSITION = 2;
const DIFFERENT_TRANSITION = 3;

const INTERSECTION = 0;
const UNION = 1;
const DIFFERENCE = 2;
const XOR = 3;

class SweepEvent {
  type = NORMAL;
  inOut = false;
  otherInOut = false;
  prevInResult: SweepEvent | null = null;
  resultTransition = 0;
  otherPos = -1;
  outputContourId = -1;
  contourId = 0;
  other!: SweepEvent;
  constructor(
    public point: P,
    public left: boolean,
    other: SweepEvent | null,
    public isSubject: boolean,
  ) {
    if (other) this.other = other;
  }
  isBelow(p: P): boolean {
    const p0 = this.point;
    const p1 = this.other.point;
    return this.left
      ? (p0[0] - p[0]) * (p1[1] - p[1]) - (p1[0] - p[0]) * (p0[1] - p[1]) > 0
      : (p1[0] - p[0]) * (p0[1] - p[1]) - (p0[0] - p[0]) * (p1[1] - p[1]) > 0;
  }
  isAbove(p: P): boolean {
    return !this.isBelow(p);
  }
  isVertical(): boolean {
    return this.point[0] === this.other.point[0];
  }
  get inResult(): boolean {
    return this.resultTransition !== 0;
  }
}

class Heap<T> {
  data: T[] = [];
  constructor(private cmp: (a: T, b: T) => number) {}
  get length(): number {
    return this.data.length;
  }
  push(item: T): void {
    const data = this.data;
    data.push(item);
    let pos = data.length - 1;
    while (pos > 0) {
      const parent = (pos - 1) >> 1;
      const current = data[parent];
      if (this.cmp(item, current) >= 0) break;
      data[pos] = current;
      pos = parent;
    }
    data[pos] = item;
  }
  pop(): T | undefined {
    const data = this.data;
    if (!data.length) return undefined;
    const top = data[0];
    const bottom = data.pop() as T;
    if (data.length) {
      let pos = 0;
      const half = data.length >> 1;
      while (pos < half) {
        let left = (pos << 1) + 1;
        let best = data[left];
        const right = left + 1;
        if (right < data.length && this.cmp(data[right], best) < 0) {
          left = right;
          best = data[right];
        }
        if (this.cmp(best, bottom) >= 0) break;
        data[pos] = best;
        pos = left;
      }
      data[pos] = bottom;
    }
    return top;
  }
}

const equals = (a: P, b: P) => a[0] === b[0] && a[1] === b[1];

function signedArea(p0: P, p1: P, p2: P): number {
  return (p0[0] - p2[0]) * (p1[1] - p2[1]) - (p1[0] - p2[0]) * (p0[1] - p2[1]);
}

function compareEvents(e1: SweepEvent, e2: SweepEvent): number {
  const p1 = e1.point;
  const p2 = e2.point;
  if (p1[0] > p2[0]) return 1;
  if (p1[0] < p2[0]) return -1;
  if (p1[1] !== p2[1]) return p1[1] > p2[1] ? 1 : -1;
  if (e1.left !== e2.left) return e1.left ? 1 : -1;
  if (signedArea(p1, e1.other.point, e2.other.point) !== 0) return !e1.isBelow(e2.other.point) ? 1 : -1;
  return !e1.isSubject && e2.isSubject ? 1 : -1;
}

function compareSegments(le1: SweepEvent, le2: SweepEvent): number {
  if (le1 === le2) return 0;
  if (signedArea(le1.point, le1.other.point, le2.point) !== 0 || signedArea(le1.point, le1.other.point, le2.other.point) !== 0) {
    if (equals(le1.point, le2.point)) return le1.isBelow(le2.other.point) ? -1 : 1;
    if (le1.point[0] === le2.point[0]) return le1.point[1] < le2.point[1] ? -1 : 1;
    if (compareEvents(le1, le2) === 1) return le2.isAbove(le1.point) ? -1 : 1;
    return le1.isBelow(le2.point) ? -1 : 1;
  }
  if (le1.isSubject === le2.isSubject) {
    if (equals(le1.point, le2.point)) {
      if (equals(le1.other.point, le2.other.point)) return 0;
      return le1.contourId > le2.contourId ? 1 : -1;
    }
  } else {
    return le1.isSubject ? -1 : 1;
  }
  return compareEvents(le1, le2) === 1 ? 1 : -1;
}

/** Intersection of segments a1-a2 and b1-b2: none, one point, or an overlap (two points). */
function segmentIntersection(a1: P, a2: P, b1: P, b2: P): P[] | null {
  const va: P = [a2[0] - a1[0], a2[1] - a1[1]];
  const vb: P = [b2[0] - b1[0], b2[1] - b1[1]];
  const e: P = [b1[0] - a1[0], b1[1] - a1[1]];
  const cross = (u: P, v: P) => u[0] * v[1] - u[1] * v[0];
  const dot = (u: P, v: P) => u[0] * v[0] + u[1] * v[1];
  const toPoint = (p: P, s: number, d: P): P => [p[0] + s * d[0], p[1] + s * d[1]];
  let kross = cross(va, vb);
  let sqrKross = kross * kross;
  const sqrLenA = dot(va, va);
  if (sqrKross > 0) {
    const s = cross(e, vb) / kross;
    if (s < 0 || s > 1) return null;
    const t = cross(e, va) / kross;
    if (t < 0 || t > 1) return null;
    if (s === 0) return [a1];
    if (s === 1) return [a2];
    if (t === 0) return [b1];
    if (t === 1) return [b2];
    const p = toPoint(a1, s, va);
    // snap to an end point when extremely close (keeps the sweep consistent)
    for (const q of [a1, a2, b1, b2]) if (Math.abs(q[0] - p[0]) < 1e-10 && Math.abs(q[1] - p[1]) < 1e-10) return [q];
    return [p];
  }
  kross = cross(e, va);
  sqrKross = kross * kross;
  if (sqrKross > 0) return null; // parallel, different lines
  const sa = dot(va, e) / sqrLenA;
  const sb = sa + dot(va, vb) / sqrLenA;
  const smin = Math.min(sa, sb);
  const smax = Math.max(sa, sb);
  if (smin <= 1 && smax >= 0) {
    if (smin === 1) return [a2];
    if (smax === 0) return [a1];
    const pa = smin > 0 ? toPoint(a1, smin, va) : a1;
    const pb = smax < 1 ? toPoint(a1, smax, va) : a2;
    // reuse exact end points of b where they fall inside a
    const fix = (p: P): P => {
      for (const q of [a1, a2, b1, b2]) if (Math.abs(q[0] - p[0]) < 1e-10 && Math.abs(q[1] - p[1]) < 1e-10) return q;
      return p;
    };
    return [fix(pa), fix(pb)];
  }
  return null;
}

function divideSegment(se: SweepEvent, p: P, queue: Heap<SweepEvent>): void {
  const r = new SweepEvent(p, false, se, se.isSubject);
  const l = new SweepEvent(p, true, se.other, se.isSubject);
  r.contourId = l.contourId = se.contourId;
  if (compareEvents(l, se.other) > 0) {
    se.other.left = true;
    l.left = false;
  }
  se.other.other = l;
  se.other = r;
  queue.push(l);
  queue.push(r);
}

function possibleIntersection(se1: SweepEvent, se2: SweepEvent, queue: Heap<SweepEvent>): number {
  const inter = segmentIntersection(se1.point, se1.other.point, se2.point, se2.other.point);
  const n = inter ? inter.length : 0;
  if (!inter || n === 0) return 0;
  if (n === 1 && (equals(se1.point, se2.point) || equals(se1.other.point, se2.other.point))) return 0;
  if (n === 2 && se1.isSubject === se2.isSubject) return 0;
  if (n === 1) {
    if (!equals(se1.point, inter[0]) && !equals(se1.other.point, inter[0])) divideSegment(se1, inter[0], queue);
    if (!equals(se2.point, inter[0]) && !equals(se2.other.point, inter[0])) divideSegment(se2, inter[0], queue);
    return 1;
  }
  const events: SweepEvent[] = [];
  let leftCoincide = false;
  let rightCoincide = false;
  if (equals(se1.point, se2.point)) leftCoincide = true;
  else if (compareEvents(se1, se2) === 1) events.push(se2, se1);
  else events.push(se1, se2);
  if (equals(se1.other.point, se2.other.point)) rightCoincide = true;
  else if (compareEvents(se1.other, se2.other) === 1) events.push(se2.other, se1.other);
  else events.push(se1.other, se2.other);

  if (leftCoincide) {
    se2.type = NON_CONTRIBUTING;
    se1.type = se2.inOut === se1.inOut ? SAME_TRANSITION : DIFFERENT_TRANSITION;
    if (!rightCoincide) divideSegment(events[1].other, events[0].point, queue);
    return 2;
  }
  if (rightCoincide) {
    divideSegment(events[0], events[1].point, queue);
    return 3;
  }
  if (events[0] !== events[3].other) {
    divideSegment(events[0], events[1].point, queue);
    divideSegment(events[1], events[2].point, queue);
    return 3;
  }
  divideSegment(events[0], events[1].point, queue);
  divideSegment(events[3].other, events[2].point, queue);
  return 3;
}

function inResult(event: SweepEvent, operation: number): boolean {
  switch (event.type) {
    case NORMAL:
      switch (operation) {
        case INTERSECTION:
          return !event.otherInOut;
        case UNION:
          return event.otherInOut;
        case DIFFERENCE:
          return (event.isSubject && event.otherInOut) || (!event.isSubject && !event.otherInOut);
        case XOR:
          return true;
      }
      return false;
    case SAME_TRANSITION:
      return operation === INTERSECTION || operation === UNION;
    case DIFFERENT_TRANSITION:
      return operation === DIFFERENCE;
    default:
      return false;
  }
}

function determineResultTransition(event: SweepEvent, operation: number): number {
  const thisIn = !event.inOut;
  const thatIn = !event.otherInOut;
  let isIn: boolean;
  switch (operation) {
    case INTERSECTION:
      isIn = thisIn && thatIn;
      break;
    case UNION:
      isIn = thisIn || thatIn;
      break;
    case XOR:
      isIn = thisIn !== thatIn;
      break;
    default:
      isIn = event.isSubject ? thisIn && !thatIn : thatIn && !thisIn;
  }
  return isIn ? 1 : -1;
}

function computeFields(event: SweepEvent, prev: SweepEvent | null, operation: number): void {
  if (prev === null) {
    event.inOut = false;
    event.otherInOut = true;
  } else {
    if (event.isSubject === prev.isSubject) {
      event.inOut = !prev.inOut;
      event.otherInOut = prev.otherInOut;
    } else {
      event.inOut = !prev.otherInOut;
      event.otherInOut = prev.isVertical() ? !prev.inOut : prev.inOut;
    }
    event.prevInResult = !inResult(prev, operation) || prev.isVertical() ? prev.prevInResult : prev;
  }
  event.resultTransition = inResult(event, operation) ? determineResultTransition(event, operation) : 0;
}

function insertSorted(sweep: SweepEvent[], ev: SweepEvent): number {
  let lo = 0;
  let hi = sweep.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (compareSegments(sweep[mid], ev) < 0) lo = mid + 1;
    else hi = mid;
  }
  sweep.splice(lo, 0, ev);
  return lo;
}

function subdivide(queue: Heap<SweepEvent>, sbbox: number[], cbbox: number[], operation: number): SweepEvent[] {
  const sweep: SweepEvent[] = [];
  const sorted: SweepEvent[] = [];
  const rightbound = Math.min(sbbox[2], cbbox[2]);
  const limit = queue.length * 60 + 200000;
  let guard = 0;
  while (queue.length) {
    if (++guard > limit) throw new Error('Boolean operation did not converge');
    let event = queue.pop() as SweepEvent;
    sorted.push(event);
    if ((operation === INTERSECTION && event.point[0] > rightbound) || (operation === DIFFERENCE && event.point[0] > sbbox[2])) break;
    if (event.left) {
      const idx = insertSorted(sweep, event);
      const prev = idx > 0 ? sweep[idx - 1] : null;
      const next = idx < sweep.length - 1 ? sweep[idx + 1] : null;
      computeFields(event, prev, operation);
      if (next && possibleIntersection(event, next, queue) === 2) {
        computeFields(event, prev, operation);
        computeFields(next, event, operation);
      }
      if (prev && possibleIntersection(prev, event, queue) === 2) {
        const pi = sweep.indexOf(prev);
        const prevprev = pi > 0 ? sweep[pi - 1] : null;
        computeFields(prev, prevprev, operation);
        computeFields(event, prev, operation);
      }
    } else {
      event = event.other;
      const idx = sweep.indexOf(event);
      if (idx >= 0) {
        const prev = idx > 0 ? sweep[idx - 1] : null;
        const next = idx < sweep.length - 1 ? sweep[idx + 1] : null;
        sweep.splice(idx, 1);
        if (prev && next) possibleIntersection(prev, next, queue);
      }
    }
  }
  return sorted;
}

interface Contour {
  points: P[];
  holeIds: number[];
  holeOf: number | null;
  depth: number;
}

function orderEvents(sortedEvents: SweepEvent[]): SweepEvent[] {
  const result: SweepEvent[] = [];
  for (const e of sortedEvents) if ((e.left && e.inResult) || (!e.left && e.other.inResult)) result.push(e);
  // overlapping edges can leave the list slightly unsorted
  let sorted = false;
  while (!sorted) {
    sorted = true;
    for (let i = 0; i + 1 < result.length; i++) {
      if (compareEvents(result[i], result[i + 1]) === 1) {
        const tmp = result[i];
        result[i] = result[i + 1];
        result[i + 1] = tmp;
        sorted = false;
      }
    }
  }
  for (let i = 0; i < result.length; i++) result[i].otherPos = i;
  for (const e of result) {
    if (!e.left) {
      const tmp = e.otherPos;
      e.otherPos = e.other.otherPos;
      e.other.otherPos = tmp;
    }
  }
  return result;
}

function nextPos(pos: number, events: SweepEvent[], processed: Uint8Array, origPos: number): number {
  let newPos = pos + 1;
  const p = events[pos].point;
  const length = events.length;
  let p1 = newPos < length ? events[newPos].point : null;
  while (newPos < length && p1 && p1[0] === p[0] && p1[1] === p[1]) {
    if (!processed[newPos]) return newPos;
    newPos++;
    p1 = newPos < length ? events[newPos].point : null;
  }
  newPos = pos - 1;
  while (newPos > origPos && processed[newPos]) newPos--;
  return newPos;
}

function initContour(event: SweepEvent, contours: Contour[], contourId: number): Contour {
  const contour: Contour = { points: [], holeIds: [], holeOf: null, depth: 0 };
  const lower = event.prevInResult;
  if (lower) {
    const lowerId = lower.outputContourId;
    if (lowerId < 0) return contour;
    if (lower.resultTransition > 0) {
      const lowerContour = contours[lowerId];
      if (lowerContour.holeOf !== null) {
        const parent = lowerContour.holeOf;
        contours[parent].holeIds.push(contourId);
        contour.holeOf = parent;
        contour.depth = lowerContour.depth;
      } else {
        lowerContour.holeIds.push(contourId);
        contour.holeOf = lowerId;
        contour.depth = lowerContour.depth + 1;
      }
    } else {
      contour.depth = contours[lowerId].depth;
    }
  }
  return contour;
}

function connectEdges(sortedEvents: SweepEvent[]): Contour[] {
  const events = orderEvents(sortedEvents);
  const processed = new Uint8Array(events.length);
  const contours: Contour[] = [];
  for (let i = 0; i < events.length; i++) {
    if (processed[i]) continue;
    const contourId = contours.length;
    const contour = initContour(events[i], contours, contourId);
    const mark = (pos: number) => {
      processed[pos] = 1;
      if (pos < events.length && events[pos]) events[pos].outputContourId = contourId;
    };
    let pos = i;
    const origPos = i;
    contour.points.push(events[i].point);
    let guard = 0;
    while (guard++ < events.length * 2 + 10) {
      mark(pos);
      pos = events[pos].otherPos;
      mark(pos);
      contour.points.push(events[pos].point);
      pos = nextPos(pos, events, processed, origPos);
      if (pos === origPos || pos < origPos || pos >= events.length || !events[pos]) break;
    }
    contours.push(contour);
  }
  return contours;
}

function closeRing(ring: Ring): Ring {
  if (ring.length && !equals(ring[0], ring[ring.length - 1])) return [...ring, ring[0]];
  return ring;
}

function fillQueue(subject: MultiPolygon, clipping: MultiPolygon, sbbox: number[], cbbox: number[]): Heap<SweepEvent> {
  const queue = new Heap<SweepEvent>(compareEvents);
  let contourId = 0;
  const process = (ring: Ring, isSubject: boolean, bbox: number[]) => {
    const pts = closeRing(ring);
    for (let i = 0; i < pts.length - 1; i++) {
      const s1 = pts[i];
      const s2 = pts[i + 1];
      if (equals(s1, s2)) continue;
      const e1 = new SweepEvent(s1, false, null, isSubject);
      const e2 = new SweepEvent(s2, false, e1, isSubject);
      e1.other = e2;
      e1.contourId = e2.contourId = contourId;
      if (compareEvents(e1, e2) > 0) e2.left = true;
      else e1.left = true;
      bbox[0] = Math.min(bbox[0], s1[0]);
      bbox[1] = Math.min(bbox[1], s1[1]);
      bbox[2] = Math.max(bbox[2], s1[0]);
      bbox[3] = Math.max(bbox[3], s1[1]);
      queue.push(e1);
      queue.push(e2);
    }
  };
  for (const poly of subject) {
    for (const ring of poly) {
      contourId++;
      process(ring, true, sbbox);
    }
  }
  for (const poly of clipping) {
    for (const ring of poly) {
      contourId++;
      process(ring, false, cbbox);
    }
  }
  return queue;
}

export interface BoolResult {
  /** Exterior rings with their holes. */
  polygons: MultiPolygon;
}

const OPS: Record<BoolOp, number> = { intersection: INTERSECTION, union: UNION, difference: DIFFERENCE, xor: XOR };

function validRings(mp: MultiPolygon): MultiPolygon {
  return mp
    .map((poly) => poly.filter((ring) => ring.length >= 3 && ring.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))))
    .filter((poly) => poly.length > 0);
}

/** Boolean operation between two multi-polygons (even-odd interpretation of each operand). */
export function booleanOp(subjectIn: MultiPolygon, clippingIn: MultiPolygon, op: BoolOp): MultiPolygon {
  const operation = OPS[op];
  const subject = validRings(subjectIn);
  const clipping = validRings(clippingIn);
  if (subject.length * clipping.length === 0) {
    if (operation === INTERSECTION) return [];
    if (operation === DIFFERENCE) return subject;
    return subject.length ? subject : clipping;
  }
  const sbbox = [Infinity, Infinity, -Infinity, -Infinity];
  const cbbox = [Infinity, Infinity, -Infinity, -Infinity];
  const queue = fillQueue(subject, clipping, sbbox, cbbox);
  if (sbbox[0] > cbbox[2] || cbbox[0] > sbbox[2] || sbbox[1] > cbbox[3] || cbbox[1] > sbbox[3]) {
    if (operation === INTERSECTION) return [];
    if (operation === DIFFERENCE) return subject;
    return [...subject, ...clipping];
  }
  const sorted = subdivide(queue, sbbox, cbbox, operation);
  const contours = connectEdges(sorted);
  const out: MultiPolygon = [];
  for (const c of contours) {
    if (c.holeOf !== null) continue;
    const rings: Ring[] = [stripClosing(c.points)];
    for (const h of c.holeIds) rings.push(stripClosing(contours[h].points));
    const valid = rings.filter((r) => r.length >= 3);
    if (valid.length && valid[0] === rings[0]) out.push(valid);
  }
  return out;
}

function stripClosing(points: P[]): Ring {
  const ring = points.slice();
  while (ring.length > 1 && equals(ring[0], ring[ring.length - 1])) ring.pop();
  return ring;
}

/** Signed area of a ring (shoelace). */
export function ringArea(ring: Ring): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

/** Area covered by a multi-polygon (outer rings minus holes). */
export function multiPolygonArea(mp: MultiPolygon): number {
  let total = 0;
  for (const poly of mp) {
    poly.forEach((ring, i) => {
      const a = Math.abs(ringArea(ring));
      total += i === 0 ? a : -a;
    });
  }
  return total;
}

/** Union of many polygons, merged pairwise (divide and conquer keeps it fast). */
export function unionAll(parts: MultiPolygon[]): MultiPolygon {
  const list = parts.filter((p) => p.length);
  if (!list.length) return [];
  let level = list;
  while (level.length > 1) {
    const next: MultiPolygon[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? booleanOp(level[i], level[i + 1], 'union') : level[i]);
    level = next;
  }
  return level[0];
}
