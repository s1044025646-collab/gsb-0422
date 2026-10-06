export type Pt = { x: number; y: number };

export class GeoError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export const MAX_COORD = 1_000_000;
export const MAX_VERTICES = 256;

export const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
export const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
export const cross = (a: Pt, b: Pt): number => a.x * b.y - a.y * b.x;
export const dot = (a: Pt, b: Pt): number => a.x * b.x + a.y * b.y;

const sgn = (v: number): number => (v > 0 ? 1 : v < 0 ? -1 : 0);

// Half-plane for polar angle: 0 = upper half (angle in [0, pi)), 1 = lower half.
const half = (v: Pt): number => (v.y > 0 || (v.y === 0 && v.x > 0) ? 0 : 1);

// Compare polar angles of two nonzero vectors. Antiparallel vectors are never "equal".
export function cmpAngle(a: Pt, b: Pt): number {
  const ha = half(a);
  const hb = half(b);
  if (ha !== hb) return ha - hb;
  const c = sgn(cross(a, b));
  return c === 0 ? 0 : -c; // positive cross => a before b (CCW)
}

function parsePoints(input: unknown): Pt[] {
  if (!Array.isArray(input)) throw new GeoError("BAD_SHAPE", "顶点必须是数组");
  const pts = input.map((p, i) => {
    if (typeof p !== "object" || p === null) throw new GeoError("BAD_SHAPE", `顶点 ${i} 不是对象`);
    const { x, y } = p as Record<string, unknown>;
    if (!Number.isInteger(x) || !Number.isInteger(y))
      throw new GeoError("BAD_COORD", `顶点 ${i} 坐标必须是整数`);
    if (Math.abs(x as number) > MAX_COORD || Math.abs(y as number) > MAX_COORD)
      throw new GeoError("BAD_COORD", `顶点 ${i} 坐标超出范围 ±${MAX_COORD}`);
    return { x: x as number, y: y as number };
  });
  return pts;
}

function twiceArea(pts: Pt[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += a.x * b.y - a.y * b.x;
  }
  return s;
}

function onSegment(a: Pt, b: Pt, p: Pt): boolean {
  return (
    cross(sub(b, a), sub(p, a)) === 0 &&
    Math.min(a.x, b.x) <= p.x && p.x <= Math.max(a.x, b.x) &&
    Math.min(a.y, b.y) <= p.y && p.y <= Math.max(a.y, b.y)
  );
}

function segmentsProperlyIntersect(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const d1 = sgn(cross(sub(b, a), sub(c, a)));
  const d2 = sgn(cross(sub(b, a), sub(d, a)));
  const d3 = sgn(cross(sub(d, c), sub(a, c)));
  const d4 = sgn(cross(sub(d, c), sub(b, c)));
  if (d1 !== d2 && d3 !== d4) {
    // touching at shared endpoints is handled by caller excluding adjacent edges
    if (d1 === 0 || d2 === 0 || d3 === 0 || d4 === 0) {
      // collinear-overlap or endpoint touch between non-adjacent edges
      if (onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b)) return true;
      return false;
    }
    return true;
  }
  if (d1 === 0 && d2 === 0) {
    // collinear: reject any overlap
    if (onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b)) return true;
  }
  return false;
}

export interface Normalized {
  vertices: Pt[]; // CCW, no collinear middle points, starts at lowest (y, then x)
  origIndex: number[]; // origIndex[k] = original input index of vertices[k]
  reversed: boolean; // true if input orientation was CW and got reversed
}

// Validate a simple strictly-convex polygon (adjacent collinear points allowed and reduced).
export function validateAndNormalize(input: unknown): Normalized {
  let pts = parsePoints(input);
  // Allow one repeated first point as a closing marker.
  if (
    pts.length >= 2 &&
    pts[0].x === pts[pts.length - 1].x &&
    pts[0].y === pts[pts.length - 1].y
  ) {
    pts = pts.slice(0, -1);
  }
  if (pts.length < 3) throw new GeoError("TOO_FEW", "至少需要 3 个顶点");
  if (pts.length > MAX_VERTICES) throw new GeoError("TOO_MANY", `顶点数超过 ${MAX_VERTICES}`);
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++)
      if (pts[i].x === pts[j].x && pts[i].y === pts[j].y)
        throw new GeoError("DUP_VERTEX", `顶点 ${i} 与 ${j} 重复`);

  let idx = pts.map((_, i) => i);
  // Remove reducible adjacent-collinear middle points (cross == 0). A 180-degree
  // spike is not reducible and will be rejected by convexity/simplicity checks.
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i - 1 + pts.length) % pts.length];
      const b = pts[i];
      const c = pts[(i + 1) % pts.length];
      if (cross(sub(b, a), sub(c, b)) === 0 && dot(sub(b, a), sub(c, b)) >= 0) {
        pts.splice(i, 1);
        idx.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  if (pts.length < 3) throw new GeoError("DEGENERATE", "约简后不足 3 个顶点");

  // Simplicity: no intersections between non-adjacent edges.
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i || j === (i + 1) % n || i === (j + 1) % n) continue;
      if (i === 0 && j === n - 1) continue;
      if (segmentsProperlyIntersect(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n]))
        throw new GeoError("SELF_INTERSECT", `边 ${i} 与边 ${j} 相交`);
    }
  }

  // All-collinear fast check (relative to the first two distinct points).
  {
    const p0 = pts[0];
    const p1 = pts.find((p) => p.x !== p0.x || p.y !== p0.y)!;
    if (pts.every((p) => cross(sub(p1, p0), sub(p, p0)) === 0))
      throw new GeoError("COLLINEAR", "所有顶点共线");
  }

  // Strict convexity: all turns share one non-zero sign (a self-intersecting
  let turnSign = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const c = pts[(i + 2) % pts.length];
    const t = sgn(cross(sub(b, a), sub(c, b)));
    if (t === 0) throw new GeoError("DEGENERATE", `顶点 ${(i + 1) % pts.length} 处退化（180 度折返）`);
    if (turnSign === 0) turnSign = t;
    else if (t !== turnSign) throw new GeoError("NON_CONVEX", "多边形不是凸多边形");
  }

  const area2 = twiceArea(pts);
  if (area2 === 0) throw new GeoError("COLLINEAR", "所有顶点共线");

  // Force CCW.
  let reversed = false;
  if (area2 < 0) {
    pts.reverse();
    idx.reverse();
    reversed = true;
  }
  // Rotate to lowest (y, then x).
  let m = 0;
  for (let i = 1; i < pts.length; i++)
    if (pts[i].y < pts[m].y || (pts[i].y === pts[m].y && pts[i].x < pts[m].x)) m = i;
  pts = pts.slice(m).concat(pts.slice(0, m));
  idx = idx.slice(m).concat(idx.slice(0, m));
  return { vertices: pts, origIndex: idx, reversed };
}

export interface MergedEdge {
  vector: Pt;
  sources: { a?: number; b?: number }; // original input edge (= start vertex) indices
}

// Core: ordered edge-vector merge (no vertex-pair enumeration, no hull library).
export function minkowskiSum(na: Normalized, nb: Normalized): { vertices: Pt[]; edges: MergedEdge[] } {
  const edgesOf = (n: Normalized) =>
    n.vertices.map((v, i) => ({
      vec: sub(n.vertices[(i + 1) % n.vertices.length], v),
      // Original edge number = original index of the segment's start vertex in
      // the input's own boundary order. If we reversed orientation, the
      // normalized edge k->k+1 was originally traversed from vertex k+1.
      src: n.reversed ? n.origIndex[(i + 1) % n.vertices.length] : n.origIndex[i],
    }));
  const ea = edgesOf(na);
  const eb = edgesOf(nb);
  const merged: MergedEdge[] = [];
  let i = 0;
  let j = 0;
  while (i < ea.length || j < eb.length) {
    if (i < ea.length && j < eb.length) {
      const c = cmpAngle(ea[i].vec, eb[j].vec);
      if (c < 0) {
        merged.push({ vector: ea[i].vec, sources: { a: ea[i].src } });
        i++;
      } else if (c > 0) {
        merged.push({ vector: eb[j].vec, sources: { b: eb[j].src } });
        j++;
      } else {
        // Same direction (same half-plane, zero cross): add and advance both.
        merged.push({ vector: add(ea[i].vec, eb[j].vec), sources: { a: ea[i].src, b: eb[j].src } });
        i++;
        j++;
      }
    } else if (i < ea.length) {
      merged.push({ vector: ea[i].vec, sources: { a: ea[i].src } });
      i++;
    } else {
      merged.push({ vector: eb[j].vec, sources: { b: eb[j].src } });
      j++;
    }
  }
  // Accumulate from the sum of both canonical start vertices.
  const start = add(na.vertices[0], nb.vertices[0]);
  const vertices: Pt[] = [start];
  const edges: MergedEdge[] = [];
  let cur = start;
  for (const e of merged) {
    if (e.vector.x === 0 && e.vector.y === 0) continue; // drop zero-length edges
    cur = add(cur, e.vector);
    edges.push(e);
    vertices.push(cur);
  }
  const last = vertices[vertices.length - 1];
  if (last.x !== start.x || last.y !== start.y)
    throw new GeoError("INTERNAL", "边向量累加未回到起点");
  vertices.pop(); // do not repeat the closing vertex
  return { vertices, edges };
}

// Normalize an already-computed result polygon for stable comparison.
export function normalizeResult(pts: Pt[]): Pt[] {
  return validateAndNormalize(pts).vertices;
}

// Translation-invariant comparison via normalized edge-vector sequences.
export function sameUpToTranslation(p: Pt[], q: Pt[]): boolean {
  let a: Normalized;
  let b: Normalized;
  try {
    a = validateAndNormalize(p);
    b = validateAndNormalize(q);
  } catch {
    return false;
  }
  if (a.vertices.length !== b.vertices.length) return false;
  const d = sub(a.vertices[0], b.vertices[0]);
  return a.vertices.every((v, i) => v.x === b.vertices[i].x + d.x && v.y === b.vertices[i].y + d.y);
}

// Independent check (tests / cross-verification only): enumerate all vertex
// sums and take the convex hull (Andrew monotone chain). Never used by the solver.
export function referenceSumHull(a: Pt[], b: Pt[]): Pt[] {
  const sums = new Map<string, Pt>();
  for (const p of a) for (const q of b) sums.set(`${p.x + q.x},${p.y + q.y}`, { x: p.x + q.x, y: p.y + q.y });
  const pts = [...sums.values()].sort((p, q2) => p.x - q2.x || p.y - q2.y);
  const cross3 = (o: Pt, p: Pt, q: Pt) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const lower: Pt[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross3(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let k = pts.length - 1; k >= 0; k--) {
    const p = pts[k];
    while (upper.length >= 2 && cross3(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper); // CCW, starts at lowest x
}
