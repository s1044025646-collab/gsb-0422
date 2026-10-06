import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.MINK_DB = path.join(mkdtempSync(path.join(tmpdir(), "mink-")), "test.db");
const { startServer } = await import("../src/api.ts");

test("API 端到端", async () => {
  const { port, close } = await startServer(0);
  assert.ok(port > 0);
  const base = `http://localhost:${port}`;
  const post = async (p: string, body: unknown) => {
    const r = await fetch(base + p, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: r.status, json: await r.json() };
  };

  const rect = (w: number, h: number) => [
    { x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h },
  ];

  const pa = await post("/polygons", { vertices: rect(2, 1) });
  assert.equal(pa.status, 201);
  const pb = await post("/polygons", { vertices: rect(3, 2) });
  const sum = await post("/sum", { aId: pa.json.id, bId: pb.json.id });
  assert.equal(sum.status, 201);
  assert.deepEqual(sum.json.vertices, [
    { x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 3 }, { x: 0, y: 3 },
  ]);
  assert.equal(sum.json.edges.length, 4);
  assert.ok(sum.json.edges.every((e: { sources: { a?: number; b?: number } }) => e.sources.a !== undefined && e.sources.b !== undefined));

  const got = await fetch(`${base}/sums/${sum.json.id}`);
  assert.equal(got.status, 200);

  // verify good and translated result
  const ok = await post("/verify", { aId: pa.json.id, bId: pb.json.id, result: rect(5, 3) });
  assert.equal(ok.json.ok, true);
  const shifted = rect(5, 3).map((p) => ({ x: p.x + 10, y: p.y - 4 }));
  const ok2 = await post("/verify", { aId: pa.json.id, bId: pb.json.id, result: shifted });
  assert.equal(ok2.json.ok, true);
  const bad = await post("/verify", { aId: pa.json.id, bId: pb.json.id, result: rect(4, 3) });
  assert.equal(bad.json.ok, false);

  // compare endpoint
  const cmp = await post("/compare", { a: rect(5, 3), b: shifted });
  assert.equal(cmp.json.sameUpToTranslation, true);

  // invalid polygon rejected with error code
  const concave = await post("/polygons", { vertices: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 0, y: 2 }] });
  assert.equal(concave.status, 422);
  assert.equal(concave.json.error.code, "NON_CONVEX");

  // export
  const exp = await fetch(`${base}/sums/${sum.json.id}/export`);
  assert.equal(exp.status, 200);
  const exported = await exp.json();
  assert.equal(exported.id, sum.json.id);

  close();
});
