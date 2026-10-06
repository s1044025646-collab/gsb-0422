import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Server } from "node:http";
import { Store } from "../src/db";
import { startServer } from "../src/server";

let server: Server;
let base: string;

before(async () => {
  const store = new Store(":memory:");
  const started = await startServer(store);
  server = started.server;
  base = `http://127.0.0.1:${started.port}`;
});

after(() => server.close());

async function post(path: string, body: unknown) {
  const res = await fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

test("API: 导入、求和、报告、核验、平移、错误码", async () => {
  const rect = (w: number, h: number) => [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
  const a = await post("/polygons", { vertices: rect(2, 1), name: "A" });
  assert.equal(a.status, 201);
  const b = await post("/polygons", { vertices: rect(3, 2), name: "B" });
  const sum = await post("/sum", { aId: a.json.id, bId: b.json.id });
  assert.equal(sum.status, 201);
  assert.deepEqual(sum.json.result.vertices, [
    { x: 0, y: 0 },
    { x: 5, y: 0 },
    { x: 5, y: 3 },
    { x: 0, y: 3 },
  ]);
  assert.equal(sum.json.result.edges[0].sources.length, 2);

  const report = await fetch(`${base}/reports/${sum.json.reportId}`);
  assert.equal(report.status, 200);

  const verify = await post("/verify", {
    reportId: sum.json.reportId,
    candidate: rect(5, 3),
  });
  assert.equal(verify.json.match, true);

  const tr = await post("/verify-translation", {
    reportId: sum.json.reportId,
    dx: 4,
    dy: -2,
  });
  assert.equal(tr.json.match, true);

  const bad = await post("/validate", {
    vertices: [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 2, y: 1 },
      { x: 0, y: 4 },
    ],
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.code, "NON_CONVEX");

  const missing = await fetch(`${base}/reports/999`);
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get("content-type"), "application/json; charset=utf-8");
});
