import * as http from "node:http";
import * as net from "node:net";
import { AddressInfo } from "node:net";
import { GeometryError, normalizePolygon } from "./geometry";
import { Store } from "./db";
import {
  NotFoundError,
  computeAndStore,
  getReport,
  importPolygon,
  verifyExternal,
  verifyTranslation,
} from "./service";

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body, null, 2);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(json);
}

function sendError(res: http.ServerResponse, err: unknown): void {
  if (err instanceof GeometryError) {
    send(res, 400, { code: err.code, message: err.message });
  } else if (err instanceof NotFoundError) {
    send(res, 404, { error: "NOT_FOUND", message: err.message });
  } else {
    send(res, 500, { error: "INTERNAL", message: String(err) });
  }
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new GeometryError("INVALID_JSON", "请求体不是合法 JSON");
  }
}

export function createServer(store: Store): http.Server {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean);
    try {
      if (req.method === "GET" && url.pathname === "/health") {
        return send(res, 200, { ok: true });
      }
      if (req.method === "POST" && url.pathname === "/validate") {
        const body = (await readBody(req)) as { vertices?: unknown };
        const normalized = normalizePolygon(body.vertices);
        return send(res, 200, { valid: true, normalized });
      }
      if (req.method === "POST" && url.pathname === "/polygons") {
        const body = (await readBody(req)) as { vertices?: unknown; name?: string };
        const { id, normalized } = importPolygon(store, body.vertices, body.name);
        return send(res, 201, { id, normalized });
      }
      if (req.method === "GET" && url.pathname === "/polygons") {
        return send(res, 200, { polygons: store.listPolygons() });
      }
      if (req.method === "GET" && parts[0] === "polygons" && parts.length === 2) {
        const row = store.getPolygon(Number(parts[1]));
        if (!row) throw new NotFoundError(`多边形 ${parts[1]} 不存在`);
        return send(res, 200, row);
      }
      if (req.method === "POST" && url.pathname === "/sum") {
        const body = (await readBody(req)) as {
          aId?: number;
          bId?: number;
          a?: unknown;
          b?: unknown;
        };
        let aId = body.aId;
        let bId = body.bId;
        if (aId === undefined && body.a !== undefined) {
          aId = importPolygon(store, body.a).id;
        }
        if (bId === undefined && body.b !== undefined) {
          bId = importPolygon(store, body.b).id;
        }
        if (aId === undefined || bId === undefined) {
          throw new GeometryError("MISSING_PARAM", "需要 aId/bId 或 a/b 顶点数组");
        }
        const { reportId, result } = computeAndStore(store, aId, bId);
        return send(res, 201, { reportId, result });
      }
      if (req.method === "GET" && parts[0] === "reports" && parts.length === 2) {
        return send(res, 200, getReport(store, Number(parts[1])));
      }
      if (req.method === "GET" && parts[0] === "reports" && parts[2] === "export") {
        const report = getReport(store, Number(parts[1]));
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="report-${report.id}.json"`,
        });
        return res.end(JSON.stringify(report, null, 2));
      }
      if (req.method === "POST" && url.pathname === "/verify") {
        const body = (await readBody(req)) as { reportId?: number; candidate?: unknown };
        if (body.reportId === undefined) {
          throw new GeometryError("MISSING_PARAM", "需要 reportId 与 candidate");
        }
        return send(res, 200, verifyExternal(store, body.reportId, body.candidate));
      }
      if (req.method === "POST" && url.pathname === "/verify-translation") {
        const body = (await readBody(req)) as { reportId?: number; dx?: number; dy?: number };
        if (body.reportId === undefined || body.dx === undefined || body.dy === undefined) {
          throw new GeometryError("MISSING_PARAM", "需要 reportId、dx、dy");
        }
        return send(res, 200, verifyTranslation(store, body.reportId, body.dx, body.dy));
      }
      send(res, 404, { error: "NOT_FOUND", message: "未知路由" });
    } catch (err) {
      sendError(res, err);
    }
  });
}

export function findFreePort(preferred?: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", () => {
      const srv2 = net.createServer();
      srv2.once("error", reject);
      srv2.listen(0, "127.0.0.1", () => {
        const port = (srv2.address() as AddressInfo).port;
        srv2.close(() => resolve(port));
      });
    });
    srv.listen(preferred ?? 0, "127.0.0.1", () => {
      const port = (srv.address() as AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

export async function startServer(
  store: Store,
  preferredPort?: number,
): Promise<{ server: http.Server; port: number }> {
  const port = await findFreePort(preferredPort);
  const server = createServer(store);
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  return { server, port };
}
