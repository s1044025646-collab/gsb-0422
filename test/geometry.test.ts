import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GeometryError,
  Point,
  angleLess,
  bruteForceSum,
  checkConvexAndClosed,
  convexHull,
  minkowskiSum,
  normalizePolygon,
  sameDirection,
  sameVertexSequence,
  translatePolygon,
} from "../src/geometry";
import { Store } from "../src/db";
import {
  computeAndStore,
  getReport,
  importPolygon,
  verifyExternal,
  verifyTranslation,
} from "../src/service";

const rect2x1: Point[] = [
  { x: 0, y: 0 },
  { x: 2, y: 0 },
  { x: 2, y: 1 },
  { x: 0, y: 1 },
];
const rect3x2: Point[] = [
  { x: 0, y: 0 },
  { x: 3, y: 0 },
  { x: 3, y: 2 },
  { x: 0, y: 2 },
];

test("矩形 2x1 + 3x2 = 5x3，平行边合并且双来源", () => {
  const a = normalizePolygon(rect2x1);
  const b = normalizePolygon(rect3x2);
  const r = minkowskiSum(a, b);
  assert.deepEqual(r.vertices, [
    { x: 0, y: 0 },
    { x: 5, y: 0 },
    { x: 5, y: 3 },
    { x: 0, y: 3 },
  ]);
  assert.equal(r.edges.length, 4);
  for (const e of r.edges) {
    assert.equal(e.sources.length, 2, "每条边应有两个来源（平行边合并）");
  }
  assert.deepEqual(r.edges[0], {
    dx: 5,
    dy: 0,
    sources: [
      { polygon: "A", edge: 0 },
      { polygon: "B", edge: 0 },
    ],
  });
});

test("三角形 + 顺时针凸四边形，结果与暴力凸包一致", () => {
  const tri: Point[] = [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 1, y: 3 },
  ];
  const quadCw: Point[] = [
    { x: 2, y: 2 },
    { x: 1, y: -2 },
    { x: -2, y: -1 },
    { x: -1, y: 1 },
  ];
  const a = normalizePolygon(tri);
  const b = normalizePolygon(quadCw);
  assert.equal(b.wasClockwise, true);
  const r = minkowskiSum(a, b);
  const brute = bruteForceSum(tri, quadCw);
  assert.ok(sameVertexSequence(r.vertices, normalizePolygon(brute).vertices));
  assert.ok(checkConvexAndClosed(r.vertices).convex);
});

test("顺逆时针与起点轮换产生相同规范结果", () => {
  const ccw = normalizePolygon(rect2x1);
  const cw = normalizePolygon(rect2x1.slice().reverse());
  const rotated = normalizePolygon([rect2x1[2], rect2x1[3], rect2x1[0], rect2x1[1]]);
  assert.ok(sameVertexSequence(ccw.vertices, cw.vertices));
  assert.ok(sameVertexSequence(ccw.vertices, rotated.vertices));
  // 轮换输入的原始编号跟随各自输入顺序
  assert.deepEqual(rotated.originalIndex, [2, 3, 0, 1]);
});

test("相邻共线中间点被去除且来源可追溯", () => {
  const withMid: Point[] = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 2, y: 0 },
    { x: 2, y: 1 },
    { x: 0, y: 1 },
  ];
  const n = normalizePolygon(withMid);
  assert.equal(n.vertices.length, 4);
  // 底边起点仍是原始顶点 0
  assert.equal(n.originalIndex[0], 0);
  const r = minkowskiSum(n, normalizePolygon(rect3x2));
  assert.deepEqual(r.vertices[1], { x: 5, y: 0 });
});

test("末尾重复首点作为闭合标记被接受", () => {
  const closed = rect2x1.concat([rect2x1[0]]);
  const n = normalizePolygon(closed);
  assert.equal(n.hadClosurePoint, true);
  assert.equal(n.vertices.length, 4);
});

test("其他重复顶点被拒绝", () => {
  const bad: Point[] = [
    { x: 0, y: 0 },
    { x: 2, y: 0 },
    { x: 1, y: 1 },
    { x: 2, y: 0 },
  ];
  assert.throws(() => normalizePolygon(bad), (e: GeometryError) => e.code === "DUPLICATE_VERTEX");
});

test("凹多边形被拒绝", () => {
  const concave: Point[] = [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 4 },
    { x: 2, y: 1 },
    { x: 0, y: 4 },
  ];
  assert.throws(() => normalizePolygon(concave), (e: GeometryError) => e.code === "NON_CONVEX");
});

test("全部共线被拒绝", () => {
  const col: Point[] = [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
    { x: 2, y: 2 },
  ];
  assert.throws(() => normalizePolygon(col), (e: GeometryError) => e.code === "COLLINEAR_ALL");
});

test("非整数与越界坐标被拒绝", () => {
  assert.throws(
    () => normalizePolygon([{ x: 0.5, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }]),
    (e: GeometryError) => e.code === "NON_INTEGER",
  );
  assert.throws(
    () =>
      normalizePolygon([
        { x: 0, y: 0 },
        { x: 2_000_000, y: 0 },
        { x: 0, y: 1 },
      ]),
    (e: GeometryError) => e.code === "OUT_OF_RANGE",
  );
});

test("极角比较：反向平行不是同向，跨零点顺序正确", () => {
  assert.equal(sameDirection(1, 0, -1, 0), false);
  assert.equal(sameDirection(1, 0, 2, 0), true);
  assert.equal(sameDirection(0, 1, 0, -1), false);
  // 正 x 轴 < 正 y 轴 < 负 x 轴 < 负 y 轴
  assert.equal(angleLess(1, 0, 0, 1), true);
  assert.equal(angleLess(0, 1, -1, 0), true);
  assert.equal(angleLess(-1, 0, 0, -1), true);
  assert.equal(angleLess(0, -1, 1, 0), false);
  assert.equal(angleLess(1, 1, 1, -1), true);
});

test("负坐标输入求和正确", () => {
  const a: Point[] = [
    { x: -5, y: -5 },
    { x: -3, y: -5 },
    { x: -4, y: -2 },
  ];
  const b: Point[] = [
    { x: -1, y: -1 },
    { x: 1, y: -1 },
    { x: 1, y: 1 },
    { x: -1, y: 1 },
  ];
  const r = minkowskiSum(normalizePolygon(a), normalizePolygon(b));
  const brute = bruteForceSum(a, b);
  assert.ok(sameVertexSequence(r.vertices, normalizePolygon(brute).vertices));
});

test("随机小夹具：边合并结果 == 暴力凸包，交换 A/B 一致，平移一致", () => {
  let seed = 42;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let iter = 0; iter < 30; iter++) {
    const mkConvex = (k: number): Point[] => {
      const pts: Point[] = [];
      for (let i = 0; i < k; i++) {
        pts.push({
          x: Math.floor(rand() * 21) - 10,
          y: Math.floor(rand() * 21) - 10,
        });
      }
      return convexHull(pts);
    };
    let pa = mkConvex(6);
    let pb = mkConvex(6);
    if (pa.length < 3 || pb.length < 3) continue;
    const ra = minkowskiSum(normalizePolygon(pa), normalizePolygon(pb));
    const rb = minkowskiSum(normalizePolygon(pb), normalizePolygon(pa));
    const brute = normalizePolygon(bruteForceSum(pa, pb));
    assert.ok(sameVertexSequence(ra.vertices, brute.vertices), `iter ${iter} vs brute`);
    assert.ok(sameVertexSequence(ra.vertices, rb.vertices), `iter ${iter} swap`);
    const dx = 3;
    const dy = -7;
    const rt = minkowskiSum(
      normalizePolygon(translatePolygon(pa, dx, dy)),
      normalizePolygon(translatePolygon(pb, dx, dy)),
    );
    // 两个输入都平移 (dx,dy)，和平移 (2dx, 2dy)
    const shifted = ra.vertices.map((p) => ({ x: p.x + 2 * dx, y: p.y + 2 * dy }));
    assert.ok(sameVertexSequence(shifted, rt.vertices), `iter ${iter} translate`);
  }
});

test("存储：导入、求和、报告、来源保留、核验与导出", () => {
  const store = new Store(":memory:");
  const aId = importPolygon(store, rect2x1, "A").id;
  const bId = importPolygon(store, rect3x2, "B").id;
  const { reportId } = computeAndStore(store, aId, bId);
  const report = getReport(store, reportId);
  assert.equal(report.result.vertices.length, 4);
  assert.equal(report.result.edges[0].sources.length, 2);
  assert.ok(report.independentCheck.convex);

  const ok = verifyExternal(store, reportId, [
    { x: 0, y: 0 },
    { x: 5, y: 0 },
    { x: 5, y: 3 },
    { x: 0, y: 3 },
  ]);
  assert.equal(ok.match, true);
  const bad = verifyExternal(store, reportId, [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 3 },
    { x: 0, y: 3 },
  ]);
  assert.equal(bad.match, false);

  const t = verifyTranslation(store, reportId, 10, 20);
  assert.equal(t.match, true);

  // 失败输入不覆盖旧数据
  const before = store.listPolygons().length;
  assert.throws(() =>
    importPolygon(store, [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ]),
  );
  assert.equal(store.listPolygons().length, before);
  store.close();
});
