export interface Point {
  x: number;
  y: number;
}

export interface EdgeSource {
  polygon: "A" | "B";
  /** 原始输入顶点编号（0 起），边 = 该顶点 -> 下一顶点 */
  edge: number;
}

export interface ResultEdge {
  dx: number;
  dy: number;
  sources: EdgeSource[];
}

export interface NormalizedPolygon {
  /** 规范化后的顶点（逆时针、最低 y/x 起点、无冗余共线点） */
  vertices: Point[];
  /** normalized[i] 对应原始输入顶点编号 */
  originalIndex: number[];
  /** 输入是否被旋转/翻转/去点（仅信息） */
  wasClockwise: boolean;
  hadClosurePoint: boolean;
}

export interface SumResult {
  vertices: Point[];
  edges: ResultEdge[];
  start: Point;
  closed: boolean;
}

export class GeometryError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "GeometryError";
  }
}

export const MAX_COORD = 1_000_000;
export const MAX_VERTICES = 256;
export const MIN_VERTICES = 3;

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function crossVec(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

/** 半平面判定：角度 [0, PI) 为 0 组（含正 x 轴），[PI, 2PI) 为 1 组（含负 x 轴）。
 *  与合并序列的循环起点一致：规范多边形首边角度 ∈ [0, 90°]，末边角度 ∈ (270°, 360°)。 */
function halfPlane(x: number, y: number): number {
  return y > 0 || (y === 0 && x > 0) ? 0 : 1;
}

/**
 * 极角比较：a 是否严格先于 b（从正 x 轴起逆时针）。
 * 先分半平面再比叉积符号，正确处理跨零点和反向平行。
 */
export function angleLess(ax: number, ay: number, bx: number, by: number): boolean {
  const ha = halfPlane(ax, ay);
  const hb = halfPlane(bx, by);
  if (ha !== hb) return ha < hb;
  return crossVec(ax, ay, bx, by) > 0;
}

/** 同向平行（含反向平行返回 false） */
export function sameDirection(ax: number, ay: number, bx: number, by: number): boolean {
  return crossVec(ax, ay, bx, by) === 0 && ax * bx + ay * by > 0;
}

/**
 * 校验并规范化多边形。
 * 接受：可选的末尾重复首点（闭合标记）、顺时针输入。
 * 拒绝：顶点数越界、非整数、坐标越界、其他重复顶点、自相交/凹、全部共线。
 */
export function normalizePolygon(raw: unknown): NormalizedPolygon {
  if (!Array.isArray(raw)) {
    throw new GeometryError("INVALID_SHAPE", "顶点必须是数组");
  }
  let pts: Point[] = raw.map((v, i) => {
    if (
      typeof v !== "object" ||
      v === null ||
      !Number.isInteger((v as Point).x) ||
      !Number.isInteger((v as Point).y)
    ) {
      throw new GeometryError("NON_INTEGER", `顶点 ${i} 坐标必须是整数 {x, y}`);
    }
    const p = v as Point;
    if (Math.abs(p.x) > MAX_COORD || Math.abs(p.y) > MAX_COORD) {
      throw new GeometryError("OUT_OF_RANGE", `顶点 ${i} 坐标超出 ±${MAX_COORD}`);
    }
    return { x: p.x, y: p.y };
  });

  let hadClosurePoint = false;
  if (
    pts.length >= 2 &&
    pts[0].x === pts[pts.length - 1].x &&
    pts[0].y === pts[pts.length - 1].y
  ) {
    hadClosurePoint = true;
    pts = pts.slice(0, -1);
  }

  if (pts.length < MIN_VERTICES || pts.length > MAX_VERTICES) {
    throw new GeometryError(
      "INVALID_VERTEX_COUNT",
      `顶点数必须在 ${MIN_VERTICES}..${MAX_VERTICES}，当前 ${pts.length}`,
    );
  }

  const seen = new Set<string>();
  for (let i = 0; i < pts.length; i++) {
    const key = `${pts[i].x},${pts[i].y}`;
    if (seen.has(key)) {
      throw new GeometryError("DUPLICATE_VERTEX", `顶点 ${i} 与之前顶点重复`);
    }
    seen.add(key);
  }

  const n = pts.length;
  let area2 = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    area2 += a.x * b.y - a.y * b.x;
  }
  if (area2 === 0) {
    throw new GeometryError("COLLINEAR_ALL", "所有顶点共线，面积为零");
  }

  // 凸性：所有连续转向符号一致（允许相邻共线，之后会被去除）
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const c = cross(pts[i], pts[(i + 1) % n], pts[(i + 2) % n]);
    if (c === 0) continue;
    const s = c > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) {
      throw new GeometryError("NON_CONVEX", `顶点 ${(i + 1) % n} 处转向不一致（凹或自相交）`);
    }
  }
  if (sign === 0) {
    throw new GeometryError("COLLINEAR_ALL", "所有顶点共线");
  }

  const wasClockwise = area2 < 0;
  let indexed = pts.map((p, i) => ({ p, orig: i }));
  if (wasClockwise) {
    // 反转保持原编号可追溯
    indexed = indexed.reverse();
  }

  // 去除可约的相邻共线中间点（转向为 0 且方向不变的点）
  const reduced: { p: Point; orig: number }[] = [];
  const m = indexed.length;
  for (let i = 0; i < m; i++) {
    const prev = indexed[(i - 1 + m) % m].p;
    const cur = indexed[i].p;
    const next = indexed[(i + 1) % m].p;
    if (cross(prev, cur, next) === 0) continue;
    reduced.push(indexed[i]);
  }
  if (reduced.length < MIN_VERTICES) {
    throw new GeometryError("COLLINEAR_ALL", "去除共线点后不足三个顶点");
  }

  // 起点：最低 y，再最低 x
  let startIdx = 0;
  for (let i = 1; i < reduced.length; i++) {
    const p = reduced[i].p;
    const s = reduced[startIdx].p;
    if (p.y < s.y || (p.y === s.y && p.x < s.x)) startIdx = i;
  }
  const rotated = reduced.slice(startIdx).concat(reduced.slice(0, startIdx));

  return {
    vertices: rotated.map((r) => r.p),
    originalIndex: rotated.map((r) => r.orig),
    wasClockwise,
    hadClosurePoint,
  };
}

interface EdgeVec {
  dx: number;
  dy: number;
  orig: number;
}

function edgeVectors(np: NormalizedPolygon): EdgeVec[] {
  const v = np.vertices;
  const n = v.length;
  const edges: EdgeVec[] = [];
  for (let i = 0; i < n; i++) {
    const next = v[(i + 1) % n];
    edges.push({
      dx: next.x - v[i].x,
      dy: next.y - v[i].y,
      orig: np.originalIndex[i],
    });
  }
  return edges;
}

/**
 * 核心：有序边向量合并（角度扫描），计算 Minkowski 和。
 * 不枚举顶点对、不调用凸包。
 */
export function minkowskiSum(a: NormalizedPolygon, b: NormalizedPolygon): SumResult {
  const ea = edgeVectors(a);
  const eb = edgeVectors(b);
  const start: Point = {
    x: a.vertices[0].x + b.vertices[0].x,
    y: a.vertices[0].y + b.vertices[0].y,
  };

  const merged: ResultEdge[] = [];
  let i = 0;
  let j = 0;
  while (i < ea.length || j < eb.length) {
    if (i < ea.length && j < eb.length) {
      const va = ea[i];
      const vb = eb[j];
      if (sameDirection(va.dx, va.dy, vb.dx, vb.dy)) {
        merged.push({
          dx: va.dx + vb.dx,
          dy: va.dy + vb.dy,
          sources: [
            { polygon: "A", edge: va.orig },
            { polygon: "B", edge: vb.orig },
          ],
        });
        i++;
        j++;
      } else if (angleLess(va.dx, va.dy, vb.dx, vb.dy)) {
        merged.push({ dx: va.dx, dy: va.dy, sources: [{ polygon: "A", edge: va.orig }] });
        i++;
      } else {
        merged.push({ dx: vb.dx, dy: vb.dy, sources: [{ polygon: "B", edge: vb.orig }] });
        j++;
      }
    } else if (i < ea.length) {
      merged.push({ dx: ea[i].dx, dy: ea[i].dy, sources: [{ polygon: "A", edge: ea[i].orig }] });
      i++;
    } else {
      merged.push({ dx: eb[j].dx, dy: eb[j].dy, sources: [{ polygon: "B", edge: eb[j].orig }] });
      j++;
    }
  }

  // 去除零长度边并合并相邻共线边（来源拼接）
  const cleaned: ResultEdge[] = [];
  for (const e of merged) {
    if (e.dx === 0 && e.dy === 0) continue;
    const last = cleaned[cleaned.length - 1];
    if (last && sameDirection(last.dx, last.dy, e.dx, e.dy)) {
      last.dx += e.dx;
      last.dy += e.dy;
      last.sources = last.sources.concat(e.sources);
    } else {
      cleaned.push({ dx: e.dx, dy: e.dy, sources: e.sources.slice() });
    }
  }
  // 首尾也可能共线（环绕合并）
  if (cleaned.length >= 2) {
    const first = cleaned[0];
    const last = cleaned[cleaned.length - 1];
    if (sameDirection(last.dx, last.dy, first.dx, first.dy)) {
      first.dx += last.dx;
      first.dy += last.dy;
      first.sources = last.sources.concat(first.sources);
      cleaned.pop();
    }
  }

  const vertices: Point[] = [];
  let cx = start.x;
  let cy = start.y;
  vertices.push({ x: cx, y: cy });
  for (const e of cleaned) {
    cx += e.dx;
    cy += e.dy;
    vertices.push({ x: cx, y: cy });
  }
  const closed =
    vertices.length > 1 &&
    vertices[vertices.length - 1].x === start.x &&
    vertices[vertices.length - 1].y === start.y;
  if (!closed) {
    throw new GeometryError("INTERNAL_NOT_CLOSED", "边向量累加未回到起点");
  }
  vertices.pop(); // 不重复闭合顶点

  return { vertices, edges: cleaned, start, closed: true };
}

/** 平移多边形（保持原编号） */
export function translatePolygon(raw: Point[], dx: number, dy: number): Point[] {
  return raw.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

/** 独立通用方法：Andrew 单调链凸包，仅用于核验，不参与正式求解 */
export function convexHull(points: Point[]): Point[] {
  const pts = points
    .slice()
    .sort((p, q) => p.x - q.x || p.y - q.y);
  const unique: Point[] = [];
  for (const p of pts) {
    const last = unique[unique.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) unique.push(p);
  }
  if (unique.length <= 2) return unique;
  const lower: Point[] = [];
  for (const p of unique) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = unique.length - 1; i >= 0; i--) {
    const p = unique[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** 独立核验：枚举全部顶点对求和取凸包（仅测试/核验用） */
export function bruteForceSum(a: Point[], b: Point[]): Point[] {
  const sums: Point[] = [];
  for (const p of a) {
    for (const q of b) {
      sums.push({ x: p.x + q.x, y: p.y + q.y });
    }
  }
  return convexHull(sums);
}

/** 独立检查：凸性、闭合（顶点序列）、极值点 */
export function checkConvexAndClosed(vertices: Point[]): {
  convex: boolean;
  minPoint: Point;
  maxPoint: Point;
} {
  const n = vertices.length;
  let sign = 0;
  let convex = true;
  for (let i = 0; i < n; i++) {
    const c = cross(vertices[i], vertices[(i + 1) % n], vertices[(i + 2) % n]);
    if (c === 0) continue;
    const s = c > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) {
      convex = false;
      break;
    }
  }
  let minPoint = vertices[0];
  let maxPoint = vertices[0];
  for (const p of vertices) {
    if (p.y < minPoint.y || (p.y === minPoint.y && p.x < minPoint.x)) minPoint = p;
    if (p.y > maxPoint.y || (p.y === maxPoint.y && p.x > maxPoint.x)) maxPoint = p;
  }
  return { convex, minPoint, maxPoint };
}

/** 比较两个规范化顶点序列是否完全一致 */
export function sameVertexSequence(a: Point[], b: Point[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((p, i) => p.x === b[i].x && p.y === b[i].y);
}
