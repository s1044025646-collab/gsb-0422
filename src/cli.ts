import * as fs from "node:fs";
import { Store } from "./db";
import { GeometryError, Point } from "./geometry";
import {
  computeAndStore,
  getReport,
  importPolygon,
  verifyExternal,
  verifyTranslation,
} from "./service";
import { startServer } from "./server";

function readJsonFile(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function printEdges(reportId: number, store: Store): void {
  const report = getReport(store, reportId);
  console.log(`报告 ${report.id}: A=${report.aId} B=${report.bId}`);
  console.log(`方法: ${report.method}`);
  console.log(`顶点 (${report.result.vertices.length}):`);
  report.result.vertices.forEach((p: Point, i: number) =>
    console.log(`  v${i}: (${p.x}, ${p.y})`),
  );
  console.log("边来源:");
  report.result.edges.forEach((e, i) => {
    const src = e.sources.map((s) => `${s.polygon}#${s.edge}`).join(" + ");
    console.log(`  e${i}: (${e.dx}, ${e.dy})  <-  ${src}`);
  });
  console.log(
    `独立检查: 凸=${report.independentCheck.convex} 极值min=(${report.independentCheck.minPoint.x},${report.independentCheck.minPoint.y})`,
  );
}

function runDemo(store: Store): void {
  console.log("=== 演示 1: 2x1 轴对齐矩形 + 3x2 矩形 = 5x3 矩形 ===");
  const rectA = [
    { x: 0, y: 0 },
    { x: 2, y: 0 },
    { x: 2, y: 1 },
    { x: 0, y: 1 },
  ];
  const rectB = [
    { x: 0, y: 0 },
    { x: 3, y: 0 },
    { x: 3, y: 2 },
    { x: 0, y: 2 },
  ];
  const a1 = importPolygon(store, rectA, "rect-2x1").id;
  const b1 = importPolygon(store, rectB, "rect-3x2").id;
  const { reportId: r1 } = computeAndStore(store, a1, b1);
  printEdges(r1, store);
  console.log("说明: 四条边全部与另一矩形同向平行边合并（每条边有两个来源）。");

  console.log("\n=== 演示 2: 三角形 + 旋转方向不同的凸四边形 ===");
  const tri = [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 1, y: 3 },
  ];
  // 顺时针输入 + 非规范起点 + 负坐标
  const quad = [
    { x: 2, y: 2 },
    { x: 1, y: -2 },
    { x: -2, y: -1 },
    { x: -1, y: 1 },
  ];
  const a2 = importPolygon(store, tri, "triangle").id;
  const b2 = importPolygon(store, quad, "quad-cw").id;
  const { reportId: r2 } = computeAndStore(store, a2, b2);
  printEdges(r2, store);

  console.log("\n=== 平移核验 (dx=7, dy=-3) ===");
  console.log(verifyTranslation(store, r2, 7, -3));
}

async function main(): Promise<void> {
  const [, , cmd, ...args] = process.argv;
  const store = new Store(process.env.MINKOWSKI_DB);
  try {
    switch (cmd) {
      case "serve": {
        const portArg = args.find((a) => a.startsWith("--port="));
        const preferred = portArg ? Number(portArg.split("=")[1]) : undefined;
        const { port } = await startServer(store, preferred);
        console.log(`API 服务已启动: http://127.0.0.1:${port}`);
        break;
      }
      case "import": {
        const [file, name] = args;
        const { id, normalized } = importPolygon(store, readJsonFile(file), name);
        console.log(`已导入多边形 id=${id}, 规范顶点数=${normalized.vertices.length}`);
        break;
      }
      case "validate": {
        const normalized = importPolygonNormalized(readJsonFile(args[0]));
        console.log(`合法。规范顶点: ${JSON.stringify(normalized.vertices)}`);
        break;
      }
      case "sum": {
        const [aId, bId] = args.map(Number);
        const { reportId } = computeAndStore(store, aId, bId);
        printEdges(reportId, store);
        break;
      }
      case "report": {
        printEdges(Number(args[0]), store);
        break;
      }
      case "verify": {
        const [reportId, file] = args;
        console.log(verifyExternal(store, Number(reportId), readJsonFile(file)));
        break;
      }
      case "translate-check": {
        const [reportId, dx, dy] = args;
        console.log(verifyTranslation(store, Number(reportId), Number(dx), Number(dy)));
        break;
      }
      case "export": {
        const [reportId, out] = args;
        const report = getReport(store, Number(reportId));
        fs.writeFileSync(out, JSON.stringify(report, null, 2));
        console.log(`已导出到 ${out}`);
        break;
      }
      case "list": {
        console.log("多边形:", store.listPolygons().map((p) => p.id));
        console.log("报告:", store.listReports().map((r) => r.id));
        break;
      }
      case "demo": {
        runDemo(store);
        break;
      }
      default:
        console.log(`用法: node dist/src/cli.js <命令>
  serve [--port=N]        启动 API 服务（默认自动选择空闲端口）
  import <file> [name]    导入多边形（JSON 顶点数组）
  validate <file>         仅校验并规范化
  sum <aId> <bId>         计算 Minkowski 和并生成报告
  report <id>             查看报告与边来源
  verify <reportId> <file> 核验外部结果
  translate-check <reportId> <dx> <dy>  平移核验
  export <reportId> <out> 导出报告 JSON
  list                    列出多边形与报告
  demo                    运行内置演示`);
    }
  } catch (err) {
    if (err instanceof GeometryError) {
      console.error(`错误 [${err.code}]: ${err.message}`);
      process.exitCode = 2;
    } else {
      console.error(`错误: ${(err as Error).message}`);
      process.exitCode = 1;
    }
  } finally {
    if (cmd !== "serve") store.close();
  }
}

function importPolygonNormalized(vertices: unknown) {
  // validate 不落库
  const { normalizePolygon } = require("./geometry");
  return normalizePolygon(vertices);
}

void main();
