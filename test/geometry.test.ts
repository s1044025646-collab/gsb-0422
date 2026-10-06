import test from "node:test";
import assert from "node:assert/strict";
import {
  validateAndNormalize,
  minkowskiSum,
  cmpAngle,
  sameUpToTranslation,
  referenceSumHull,
  GeoError,
  type Pt,
} from "../src/geometry.ts";

const pts = (a: number[][]): Pt[] => a.map(([x, y]) => ({ x, y }));

const rect = (w: number, h: number): Pt[] => pts([[0, 0], [w, 0], [w, h], [0, h]]);

test("矩形 2x1 + 3x2 = 5x3，平行边合并", () => {
  const na = validateAndNormalize(rect(2, 1));
  const nb = validateAndNormalize(rect(3, 2));
  const { vertices, edges } = minkowskiSum(na, nb);
  assert.deepEqual(vertices, pts([[0, 0], [5, 0], [5, 3], [0, 3]]));
  assert.equal(edges.length, 4);
  // every edge comes from both inputs (parallel merge)
  for (const e of edges) {
    assert.ok(e.sources.a !== undefined && e.sources.b !== undefined);
  }
  assert.deepEqual(edges[0].vector, { x: 5, y: 0 });
});

test("三角形 + 顺时针四边形", () => {
  const tri = validateAndNormalize(pts([[0, 0], [4, 0], [0, 3]]));
  const quadCW = validateAndNormalize(pts([[0, 0], [1, 2], [3, 2], [4, 0]]));
  assert.equal(quadCW.reversed, true);
  const { vertices } = minkowskiSum(tri, quadCW);
  const ref = referenceSumHull(pts([[0, 0], [4, 0], [0, 3]]), pts([[0, 0], [1, 2], [3, 2], [4, 0]]));
  assert.ok(sameUpToTranslation(vertices, ref));
});

test("CW 输入与 CCW 输入结果一致；起点轮换一致", () => {
  const ccw = pts([[0, 0], [3, 0], [3, 2], [1, 4], [0, 2]]);
  const cw = [...ccw].reverse();
  const rotated = [ccw[2], ccw[3], ccw[4], ccw[0], ccw[1]];
  const other = pts([[0, 0], [2, 0], [2, 2], [0, 2]]);
  const r1 = minkowskiSum(validateAndNormalize(ccw), validateAndNormalize(other)).vertices;
  const r2 = minkowskiSum(validateAndNormalize(cw), validateAndNormalize(other)).vertices;
  const r3 = minkowskiSum(validateAndNormalize(rotated), validateAndNormalize(other)).vertices;
  assert.deepEqual(r1, r2);
  assert.deepEqual(r1, r3);
});

test("相邻共线点被约简", () => {
  const n = validateAndNormalize(pts([[0, 0], [1, 0], [2, 0], [2, 2], [0, 2]]));
  assert.equal(n.vertices.length, 4);
  // traceability: kept vertices keep original indices
  assert.deepEqual(n.origIndex, [0, 2, 3, 4]);
});

test("闭合重复首点可接受", () => {
  const n = validateAndNormalize(pts([[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]));
  assert.equal(n.vertices.length, 4);
});

test("负坐标与平移只平移输出", () => {
  const a = pts([[-5, -5], [-1, -5], [-3, -1]]);
  const b = pts([[0, 0], [2, 0], [2, 2], [0, 2]]);
  const shift = (ps: Pt[], dx: number, dy: number) => ps.map((p) => ({ x: p.x + dx, y: p.y + dy }));
  const r1 = minkowskiSum(validateAndNormalize(a), validateAndNormalize(b)).vertices;
  const r2 = minkowskiSum(validateAndNormalize(shift(a, 7, -3)), validateAndNormalize(b)).vertices;
  assert.ok(sameUpToTranslation(r1, r2));
  const d = { x: r2[0].x - r1[0].x, y: r2[0].y - r1[0].y };
  assert.deepEqual(d, { x: 7, y: -3 });
});

test("拒绝非法输入", () => {
  assert.throws(() => validateAndNormalize(pts([[0, 0], [2, 0], [1, 1], [2, 2], [0, 2]])), (e: unknown) => e instanceof GeoError && e.code === "NON_CONVEX");
  assert.throws(() => validateAndNormalize(pts([[0, 0], [1, 1], [2, 2]])), (e: unknown) => (e as GeoError).code === "COLLINEAR" || (e as GeoError).code === "DEGENERATE");
  assert.throws(() => validateAndNormalize(pts([[0, 0], [1, 0], [1, 0], [0, 1]])), (e: unknown) => (e as GeoError).code === "DUP_VERTEX");
  assert.throws(() => validateAndNormalize(pts([[0, 0], [2, 0], [0, 2], [2, 2]])), (e: unknown) => ["SELF_INTERSECT", "NON_CONVEX"].includes((e as GeoError).code));
  assert.throws(() => validateAndNormalize(pts([[0, 0], [2000001, 0], [0, 1]])), (e: unknown) => (e as GeoError).code === "BAD_COORD");
  assert.throws(() => validateAndNormalize(pts([[0, 0], [1, 0]])), (e: unknown) => (e as GeoError).code === "TOO_FEW");
});

test("极角比较：半平面与反向平行", () => {
  const east = { x: 1, y: 0 };
  const west = { x: -1, y: 0 };
  const north = { x: 0, y: 1 };
  const south = { x: 0, y: -1 };
  assert.equal(cmpAngle(east, west) !== 0, true); // antiparallel not "same"
  assert.ok(cmpAngle(east, north) < 0);
  assert.ok(cmpAngle(north, west) < 0);
  assert.ok(cmpAngle(west, south) < 0);
  assert.ok(cmpAngle(south, east) > 0); // wrap-around across angle zero
  assert.ok(cmpAngle(east, south) < 0);
  assert.equal(cmpAngle({ x: 2, y: 2 }, { x: 5, y: 5 }), 0); // same direction
});

// Deterministic pseudo-random convex polygon fixture generator.
function randomConvex(seed: number, n: number, r: number): Pt[] {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const angles = Array.from({ length: n }, () => rnd() * 2 * Math.PI).sort((a, b) => a - b);
  const ps = angles.map((t) => ({ x: Math.round(r * (0.3 + rnd()) * Math.cos(t)), y: Math.round(r * (0.3 + rnd()) * Math.sin(t)) }));
  try {
    return validateAndNormalize(ps).vertices;
  } catch {
    return randomConvex(seed + 1, n, r);
  }
}

test("小夹具：与枚举顶点对+凸包的独立答案一致；交换 A/B 一致", () => {
  for (let seed = 1; seed <= 30; seed++) {
    const a = randomConvex(seed * 7 + 1, 3 + (seed % 5), 50);
    const b = randomConvex(seed * 13 + 5, 3 + (seed % 6), 50);
    const na = validateAndNormalize(a);
    const nb = validateAndNormalize(b);
    const sumAB = minkowskiSum(na, nb).vertices;
    const sumBA = minkowskiSum(nb, na).vertices;
    assert.deepEqual(sumAB, sumBA, `seed ${seed}: 交换后规范结果应一致`);
    const ref = referenceSumHull(a, b);
    assert.ok(sameUpToTranslation(sumAB, ref), `seed ${seed}: 与凸包参考不一致`);
  }
});

test("结果无重复闭合点、无零边、无冗余共线点", () => {
  const a = validateAndNormalize(rect(2, 1));
  const b = validateAndNormalize(pts([[0, 0], [4, 1], [3, 3], [-1, 2]]));
  const { vertices, edges } = minkowskiSum(a, b);
  const first = vertices[0];
  const last = vertices[vertices.length - 1];
  assert.notDeepEqual(first, last);
  for (const e of edges) assert.notDeepEqual(e.vector, { x: 0, y: 0 });
  for (let i = 0; i < vertices.length; i++) {
    const p = vertices[i];
    const q = vertices[(i + 1) % vertices.length];
    const r = vertices[(i + 2) % vertices.length];
    const cr = (q.x - p.x) * (r.y - q.y) - (q.y - p.y) * (r.x - q.x);
    assert.notEqual(cr, 0);
  }
});
