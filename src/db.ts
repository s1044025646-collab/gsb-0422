import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import { NormalizedPolygon, SumResult } from "./geometry";

export interface PolygonRow {
  id: number;
  name: string | null;
  created_at: string;
  original: string;
  normalized: string;
  meta: string;
}

export interface ReportRow {
  id: number;
  a_id: number;
  b_id: number;
  created_at: string;
  method: string;
  result: string;
}

export const METHOD = "edge-vector-merge/1 (ccw, lowest-y-x start, integer exact)";

export class Store {
  private db: DatabaseSync;

  constructor(dbPath?: string) {
    const file =
      dbPath ?? path.join(process.cwd(), "data", "minkowski.db");
    if (file !== ":memory:") {
      fs.mkdirSync(path.dirname(file), { recursive: true });
    }
    this.db = new DatabaseSync(file);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS polygons (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        created_at TEXT NOT NULL,
        original TEXT NOT NULL,
        normalized TEXT NOT NULL,
        meta TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        a_id INTEGER NOT NULL REFERENCES polygons(id),
        b_id INTEGER NOT NULL REFERENCES polygons(id),
        created_at TEXT NOT NULL,
        method TEXT NOT NULL,
        result TEXT NOT NULL
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  insertPolygon(
    name: string | null,
    original: unknown,
    normalized: NormalizedPolygon,
  ): number {
    const stmt = this.db.prepare(
      "INSERT INTO polygons (name, created_at, original, normalized, meta) VALUES (?, ?, ?, ?, ?)",
    );
    const meta = {
      wasClockwise: normalized.wasClockwise,
      hadClosurePoint: normalized.hadClosurePoint,
      vertexCount: normalized.vertices.length,
    };
    const r = stmt.run(
      name,
      new Date().toISOString(),
      JSON.stringify(original),
      JSON.stringify(normalized),
      JSON.stringify(meta),
    );
    return Number(r.lastInsertRowid);
  }

  getPolygon(id: number): PolygonRow | undefined {
    return this.db
      .prepare("SELECT * FROM polygons WHERE id = ?")
      .get(id) as PolygonRow | undefined;
  }

  listPolygons(): PolygonRow[] {
    return this.db
      .prepare("SELECT * FROM polygons ORDER BY id")
      .all() as unknown as PolygonRow[];
  }

  insertReport(aId: number, bId: number, result: SumResult): number {
    const stmt = this.db.prepare(
      "INSERT INTO reports (a_id, b_id, created_at, method, result) VALUES (?, ?, ?, ?, ?)",
    );
    const r = stmt.run(
      aId,
      bId,
      new Date().toISOString(),
      METHOD,
      JSON.stringify(result),
    );
    return Number(r.lastInsertRowid);
  }

  getReport(id: number): ReportRow | undefined {
    return this.db
      .prepare("SELECT * FROM reports WHERE id = ?")
      .get(id) as ReportRow | undefined;
  }

  listReports(): ReportRow[] {
    return this.db
      .prepare("SELECT * FROM reports ORDER BY id")
      .all() as unknown as ReportRow[];
  }
}
