import http from "node:http";
import { validateAndNormalize, minkowskiSum, sameUpToTranslation, GeoError } from "./geometry.ts";
import { savePolygon, getPolygon, listPolygons, saveSum, getSum } from "./store.ts";

type Json = Record<string, unknown>;

function send(res: http.ServerResponse, status: number, body: unknown) {
  const s = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(s);
}

function err(res: http.ServerResponse, status: number, code: string, message: string) {
  send(res, status, { error: { code, message } });
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new GeoError("BAD_JSON", "请求体不是合法 JSON");
  }
}

function computeSum(aId: number, bId: number) {
  const pa = getPolygon(aId);
  const pb = getPolygon(bId);
  if (!pa) throw new GeoError("NOT_FOUND", `多边形 ${aId} 不存在`);
  if (!pb) throw new GeoError("NOT_FOUND", `多边形 ${bId} 不存在`);
  const { vertices, edges } = minkowskiSum(pa.normalized, pb.normalized);
  const id = saveSum(aId, bId, vertices, edges);
  return { id, aId, bId, vertices, edges };
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean);
    try {
      const body = req.method === "POST" ? ((await readBody(req)) as Json) : {};

      if (req.method === "GET" && parts.length === 0)
        return send(res, 200, { name: "minkowski-sum", endpoints: ["POST /polygons", "GET /polygons", "GET /polygons/:id", "POST /sum", "GET /sums/:id", "POST /verify", "POST /compare", "GET /sums/:id/export"] });

      if (req.method === "POST" && parts[0] === "polygons" && parts.length === 1) {
        const n = validateAndNormalize(body.vertices);
        const id = savePolygon(body.vertices as never, n);
        return send(res, 201, { id, normalized: n.vertices, origIndex: n.origIndex, reversed: n.reversed });
      }
      if (req.method === "GET" && parts[0] === "polygons" && parts.length === 1)
        return send(res, 200, { polygons: listPolygons() });
      if (req.method === "GET" && parts[0] === "polygons" && parts.length === 2) {
        const p = getPolygon(Number(parts[1]));
        if (!p) return err(res, 404, "NOT_FOUND", "多边形不存在");
        return send(res, 200, p);
      }
      if (req.method === "POST" && parts[0] === "sum" && parts.length === 1) {
        const aId = Number(body.aId);
        const bId = Number(body.bId);
        if (!Number.isInteger(aId) || !Number.isInteger(bId))
          return err(res, 400, "BAD_SHAPE", "需要整数 aId 与 bId");
        return send(res, 201, computeSum(aId, bId));
      }
      if (req.method === "GET" && parts[0] === "sums" && parts.length === 2) {
        const s = getSum(Number(parts[1]));
        if (!s) return err(res, 404, "NOT_FOUND", "求和报告不存在");
        return send(res, 200, s);
      }
      if (req.method === "GET" && parts[0] === "sums" && parts[2] === "export") {
        const s = getSum(Number(parts[1]));
        if (!s) return err(res, 404, "NOT_FOUND", "求和报告不存在");
        res.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "content-disposition": `attachment; filename="sum-${s.id}.json"`,
        });
        return res.end(JSON.stringify(s, null, 2));
      }
      if (req.method === "POST" && parts[0] === "verify" && parts.length === 1) {
        const aId = Number(body.aId);
        const bId = Number(body.bId);
        if (!Number.isInteger(aId) || !Number.isInteger(bId))
          return err(res, 400, "BAD_SHAPE", "需要整数 aId 与 bId");
        const pa = getPolygon(aId);
        const pb = getPolygon(bId);
        if (!pa || !pb) return err(res, 404, "NOT_FOUND", "多边形不存在");
        // Validate the submitted result on its own merits (convex, closed, sane).
        const submitted = validateAndNormalize(body.result);
        const expected = minkowskiSum(pa.normalized, pb.normalized);
        const ok = sameUpToTranslation(expected.vertices, submitted.vertices);
        return send(res, 200, { ok, expected: expected.vertices });
      }
      if (req.method === "POST" && parts[0] === "compare" && parts.length === 1) {
        const a = validateAndNormalize(body.a);
        const b = validateAndNormalize(body.b);
        return send(res, 200, { sameUpToTranslation: sameUpToTranslation(a.vertices, b.vertices) });
      }
      return err(res, 404, "NO_ROUTE", "路由不存在");
    } catch (e) {
      if (e instanceof GeoError) return err(res, 422, e.code, e.message);
      return err(res, 500, "INTERNAL", String(e));
    }
  });
}

export function startServer(port?: number): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(port ?? Number(process.env.PORT ?? 0), () => {
      const addr = server.address();
      const p = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ port: p, close: () => server.close() });
    });
  });
}
