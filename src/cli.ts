import { readFileSync, writeFileSync } from "node:fs";
import { validateAndNormalize, minkowskiSum, sameUpToTranslation, GeoError } from "./geometry.ts";
import { savePolygon, getPolygon, saveSum, getSum, listPolygons } from "./store.ts";
import { startServer } from "./api.ts";

const [, , cmd, ...args] = process.argv;

const readJson = (f: string) => JSON.parse(readFileSync(f, "utf8"));
const out = (v: unknown) => console.log(JSON.stringify(v, null, 2));

function demo() {
  const rectA = [
    { x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 0, y: 1 },
  ];
  const rectB = [
    { x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 2 }, { x: 0, y: 2 },
  ];
  const tri = [
    { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 3 },
  ];
  // Convex quad given clockwise (will be normalized to CCW).
  const quadCW = [
    { x: 0, y: 0 }, { x: 1, y: 2 }, { x: 3, y: 2 }, { x: 4, y: 0 },
  ];
  for (const [name, a, b] of [
    ["矩形 2x1 + 矩形 3x2", rectA, rectB],
    ["三角形 + 顺时针四边形", tri, quadCW],
  ] as const) {
    const na = validateAndNormalize(a);
    const nb = validateAndNormalize(b);
    const { vertices, edges } = minkowskiSum(na, nb);
    console.log(`\n== ${name} ==`);
    console.log("结果顶点:", JSON.stringify(vertices));
    console.log("边来源:");
    edges.forEach((e, i) =>
      console.log(
        `  边${i}: 向量(${e.vector.x},${e.vector.y}) 来自 ` +
          [e.sources.a !== undefined ? `A边${e.sources.a}` : "", e.sources.b !== undefined ? `B边${e.sources.b}` : ""]
            .filter(Boolean)
            .join(" + "),
      ),
    );
  }
}

async function main() {
  switch (cmd) {
    case "serve": {
      const pi = args.indexOf("--port");
      const port = pi >= 0 ? Number(args[pi + 1]) : undefined;
      const { port: p } = await startServer(port);
      console.log(`API 已启动: http://localhost:${p}`);
      break;
    }
    case "import": {
      const n = validateAndNormalize(readJson(args[0]));
      const id = savePolygon(readJson(args[0]), n);
      out({ id, normalized: n.vertices, origIndex: n.origIndex, reversed: n.reversed });
      break;
    }
    case "validate": {
      const n = validateAndNormalize(readJson(args[0]));
      out({ ok: true, normalized: n.vertices, origIndex: n.origIndex, reversed: n.reversed });
      break;
    }
    case "list":
      out(listPolygons());
      break;
    case "sum": {
      const pa = getPolygon(Number(args[0]));
      const pb = getPolygon(Number(args[1]));
      if (!pa || !pb) throw new GeoError("NOT_FOUND", "多边形 id 不存在");
      const { vertices, edges } = minkowskiSum(pa.normalized, pb.normalized);
      const id = saveSum(pa.id, pb.id, vertices, edges);
      out({ id, vertices, edges });
      break;
    }
    case "sources": {
      const s = getSum(Number(args[0]));
      if (!s) throw new GeoError("NOT_FOUND", "求和报告不存在");
      out(s.edges);
      break;
    }
    case "verify": {
      const pa = getPolygon(Number(args[0]));
      const pb = getPolygon(Number(args[1]));
      if (!pa || !pb) throw new GeoError("NOT_FOUND", "多边形 id 不存在");
      const submitted = validateAndNormalize(readJson(args[2]));
      const expected = minkowskiSum(pa.normalized, pb.normalized);
      out({ ok: sameUpToTranslation(expected.vertices, submitted.vertices), expected: expected.vertices });
      break;
    }
    case "compare": {
      const a = validateAndNormalize(readJson(args[0]));
      const b = validateAndNormalize(readJson(args[1]));
      out({ sameUpToTranslation: sameUpToTranslation(a.vertices, b.vertices) });
      break;
    }
    case "export": {
      const s = getSum(Number(args[0]));
      if (!s) throw new GeoError("NOT_FOUND", "求和报告不存在");
      const text = JSON.stringify(s, null, 2);
      if (args[1]) {
        writeFileSync(args[1], text);
        console.log(`已导出到 ${args[1]}`);
      } else console.log(text);
      break;
    }
    case "demo":
      demo();
      break;
    default:
      console.log(`用法: node src/cli.ts <命令>
  serve [--port N]     启动 API（默认自动选择空闲端口）
  import <file.json>   校验并保存多边形
  validate <file.json> 仅校验
  list                 列出多边形
  sum <aId> <bId>      计算 Minkowski 和并保存报告
  sources <sumId>      查询结果边来源
  verify <aId> <bId> <result.json>  核验外部结果
  compare <a.json> <b.json>         平移等价比较
  export <sumId> [out.json]         导出报告 JSON
  demo                 运行内置演示`);
  }
}

main().catch((e) => {
  if (e instanceof GeoError) {
    console.error(`错误 [${e.code}]: ${e.message}`);
    process.exit(2);
  }
  console.error(e);
  process.exit(1);
});
