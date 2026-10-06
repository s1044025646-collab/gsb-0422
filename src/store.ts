import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Normalized, Pt } from "./geometry.ts";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dbPath = process.env.MINK_DB ?? path.join(root, "data", "minkowski.db");
mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new DatabaseSync(dbPath);
db.exec(`
CREATE TABLE IF NOT EXISTS polygons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vertices TEXT NOT NULL,        -- original input coordinates
  normalized TEXT NOT NULL,      -- canonical CCW form
  orig_index TEXT NOT NULL,      -- normalizedized vertex -> original index
  reversed INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sums (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  a_id INTEGER NOT NULL,
  b_id INTEGER NOT NULL,
  method TEXT NOT NULL,          -- computation convention note
  result TEXT NOT NULL,          -- result vertices (no closing repeat)
  edges TEXT NOT NULL,           -- merged edges with source edge numbers
  created_at TEXT NOT NULL
);
`);

const METHOD = "edge-vector-merge/v1; ccw; start=min(y,x); integer-exact";

export interface PolygonRow {
  id: number;
  vertices: Pt[];
  normalized: Normalized;
  createdAt: string;
}

export function savePolygon(vertices: Pt[], n: Normalized): number {
  const r = db
    .prepare("INSERT INTO polygons (vertices, normalized, orig_index, reversed, created_at) VALUES (?,?,?,?,?)")
    .run(
      JSON.stringify(vertices),
      JSON.stringify(n.vertices),
      JSON.stringify(n.origIndex),
      n.reversed ? 1 : 0,
      new Date().toISOString(),
    );
  return Number(r.lastInsertRowid);
}

export function getPolygon(id: number): PolygonRow | null {
  const row = db.prepare("SELECT * FROM polygons WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;
  return {
    id: row.id as number,
    vertices: JSON.parse(row.vertices as string),
    normalized: {
      vertices: JSON.parse(row.normalized as string),
      origIndex: JSON.parse(row.orig_index as string),
      reversed: (row.reversed as number) === 1,
    },
    createdAt: row.created_at as string,
  };
}

export function listPolygons(): { id: number; createdAt: string; count: number }[] {
  const rows = db.prepare("SELECT id, vertices, created_at FROM polygons ORDER BY id").all() as Record<string, unknown>[];
  return rows.map((r) => ({
    id: r.id as number,
    createdAt: r.created_at as string,
    count: (JSON.parse(r.vertices as string) as unknown[]).length,
  }));
}

export function saveSum(aId: number, bId: number, result: Pt[], edges: unknown): number {
  const r = db
    .prepare("INSERT INTO sums (a_id, b_id, method, result, edges, created_at) VALUES (?,?,?,?,?,?)")
    .run(aId, bId, METHOD, JSON.stringify(result), JSON.stringify(edges), new Date().toISOString());
  return Number(r.lastInsertRowid);
}

export function getSum(id: number) {
  const row = db.prepare("SELECT * FROM sums WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: row.id as number,
    aId: row.a_id as number,
    bId: row.b_id as number,
    method: row.method as string,
    result: JSON.parse(row.result as string) as Pt[],
    edges: JSON.parse(row.edges as string),
    createdAt: row.created_at as string,
  };
}
