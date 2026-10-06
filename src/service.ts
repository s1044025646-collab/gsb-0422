import {
  GeometryError,
  NormalizedPolygon,
  Point,
  SumResult,
  checkConvexAndClosed,
  minkowskiSum,
  normalizePolygon,
  sameVertexSequence,
  translatePolygon,
} from "./geometry";
import { Store } from "./db";

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export function loadNormalized(store: Store, id: number): NormalizedPolygon {
  const row = store.getPolygon(id);
  if (!row) throw new NotFoundError(`多边形 ${id} 不存在`);
  return JSON.parse(row.normalized) as NormalizedPolygon;
}

export function loadOriginal(store: Store, id: number): Point[] {
  const row = store.getPolygon(id);
  if (!row) throw new NotFoundError(`多边形 ${id} 不存在`);
  return JSON.parse(row.original) as Point[];
}

export function importPolygon(
  store: Store,
  vertices: unknown,
  name?: string,
): { id: number; normalized: NormalizedPolygon } {
  const normalized = normalizePolygon(vertices);
  const id = store.insertPolygon(name ?? null, vertices, normalized);
  return { id, normalized };
}

export function computeAndStore(
  store: Store,
  aId: number,
  bId: number,
): { reportId: number; result: SumResult } {
  const a = loadNormalized(store, aId);
  const b = loadNormalized(store, bId);
  const result = minkowskiSum(a, b);
  const reportId = store.insertReport(aId, bId, result);
  return { reportId, result };
}

export function getReport(store: Store, reportId: number) {
  const row = store.getReport(reportId);
  if (!row) throw new NotFoundError(`报告 ${reportId} 不存在`);
  const result = JSON.parse(row.result) as SumResult;
  const check = checkConvexAndClosed(result.vertices);
  return {
    id: row.id,
    aId: row.a_id,
    bId: row.b_id,
    createdAt: row.created_at,
    method: row.method,
    result,
    independentCheck: check,
  };
}

/** 核验外部结果：与内部边合并结果逐点比较（候选先规范化） */
export function verifyExternal(
  store: Store,
  reportId: number,
  candidate: unknown,
): { match: boolean; detail: string } {
  const report = getReport(store, reportId);
  const candNorm = normalizePolygon(candidate);
  const expected = report.result.vertices;
  const match = sameVertexSequence(expected, candNorm.vertices);
  return {
    match,
    detail: match
      ? "候选结果与边合并计算结果一致"
      : `不一致：期望 ${expected.length} 个顶点，候选规范化后 ${candNorm.vertices.length} 个`,
  };
}

/** 平移核验：两个输入各平移 (dx,dy) 后重新求和，结果应等于原结果平移 (2dx, 2dy) */
export function verifyTranslation(
  store: Store,
  reportId: number,
  dx: number,
  dy: number,
): { match: boolean; detail: string } {
  if (!Number.isInteger(dx) || !Number.isInteger(dy)) {
    throw new GeometryError("NON_INTEGER", "平移量必须是整数");
  }
  const report = getReport(store, reportId);
  const aOrig = loadOriginal(store, report.aId);
  const bOrig = loadOriginal(store, report.bId);
  const aT = normalizePolygon(translatePolygon(aOrig, dx, dy));
  const bT = normalizePolygon(translatePolygon(bOrig, dx, dy));
  const shifted = minkowskiSum(aT, bT);
  const expected = report.result.vertices.map((p) => ({ x: p.x + 2 * dx, y: p.y + 2 * dy }));
  const match = sameVertexSequence(expected, shifted.vertices);
  return {
    match,
    detail: match
      ? `平移 (${dx}, ${dy}) 后结果一致`
      : "平移后结果不一致",
  };
}
