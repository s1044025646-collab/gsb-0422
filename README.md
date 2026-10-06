# 凸多边形 Minkowski 和与边向量合并核验后端

纯本地后端（TypeScript + Node.js + SQLite），计算两个平面凸多边形的 Minkowski 和，
并为每条结果边记录其来源输入边编号。仅提供 HTTP API 与 CLI，无前端。
不依赖 Docker / WSL / 付费服务 / 在线 API。

## 范围与限制

- 仅处理**简单凸多边形**：至少 3 个不共线顶点，按边界顺序给出（顺、逆时针均可）。
- 不支持：孔洞、非凸区域、曲线、三维多面体、路径规划；结果**不构成**任何机器人碰撞安全保证。
- 坐标为整数，绝对值 ≤ 1,000,000；每个多边形顶点数 ≤ 256。
  加法、叉积、面积累积均在 IEEE 754 双精度精确整数范围（2^53）内，全程精确整数运算。
- 可接受：顺时针输入、重复一次首点作为闭合标记、相邻共线中间点（会被约简）。
- 明确拒绝：其他重复顶点、自相交、非凸、全部共线、180° 折返、坐标越界、顶点数超限。
  所有校验在发布结果前完成，不会对非法输入静默取凸包。

## 核心算法

正式求解**只**使用有序边向量合并（`src/geometry.ts` 的 `minkowskiSum`）：

1. 规范化：去闭合重复点 → 约简相邻共线中间点 → 校验凸性/简单性 → 统一为逆时针 →
   旋转到 (y 最小, 再 x 最小) 的顶点作为起点。
2. 两个多边形的边向量按绕行顺序形成序列，按极角归并：
   极角比较先分半平面（上半为 0，下半为 1）再比叉积符号，反向平行边不会被当作同向，
   跨角度零点顺序正确；同向平行边向量相加并同时推进两个序列。
3. 输出起点 = 两个规范起点之和，依次累加合并后的向量；去除零长度边，
   不重复闭合顶点，并断言累加回到起点。
4. 每条结果边保存来源 `{a?, b?}`，编号为**原始输入**中边起点顶点的下标
   （顺时针输入被反转时映射回原边起点），规范化不会丢失可追溯关系。

`referenceSumHull`（枚举全部顶点对 + Andrew 单调链凸包）仅用于测试与独立核验，
不参与正式求解。

## 环境要求

- Windows 本地，Node.js ≥ 22.5（使用内置 `node:sqlite` 与 TypeScript 类型擦除运行；开发环境为 Node 25）。
- 依赖仅 `typescript` 与 `@types/node`（开发依赖）。`npm install` 后即可。

## 命令

```powershell
npm install        # 安装开发依赖
npm run build      # 类型检查并编译到 dist/
npm test           # 运行全部测试（几何核心 + API 集成）
npm run demo       # 内置演示：矩形2x1+矩形3x2=5x3（平行边合并），三角形+顺时针四边形
npm start          # 启动 API，默认自动选择空闲端口并打印
node src/cli.ts serve --port 8080   # 指定端口
```

CLI（`node src/cli.ts <命令>`，多边形文件为顶点 JSON 数组）：

- `import <file.json>` 校验并保存多边形，返回 id
- `validate <file.json>` 仅校验
- `list` 列出多边形
- `sum <aId> <bId>` 计算并保存求和报告（含边来源）
- `sources <sumId>` 查询结果边来源
- `verify <aId> <bId> <result.json>` 核验外部结果（允许整体平移）
- `compare <a.json> <b.json>` 平移等价比较
- `export <sumId> [out.json]` 导出报告 JSON
- `demo` 内置演示

## HTTP API

默认端口为空闲端口（也可用 `--port` 或环境变量 `PORT` 指定）。所有错误返回
`{"error": {"code": "...", "message": "..."}}`。

- `POST /polygons` `{vertices:[{x,y},...]}` → 校验并保存，返回 `{id, normalized, origIndex, reversed}`
- `GET /polygons` / `GET /polygons/:id`
- `POST /sum` `{aId, bId}` → 计算并保存报告 `{id, vertices, edges:[{vector, sources}]}`
- `GET /sums/:id` 查询报告与边来源
- `GET /sums/:id/export` 下载报告 JSON
- `POST /verify` `{aId, bId, result}` → `{ok, expected}`（先独立校验外部结果的凸性/闭合，再平移比较）
- `POST /compare` `{a, b}` → `{sameUpToTranslation}`

错误码：`BAD_SHAPE` `BAD_COORD` `TOO_FEW` `TOO_MANY` `DUP_VERTEX` `COLLINEAR`
`DEGENERATE` `NON_CONVEX` `SELF_INTERSECT` `NOT_FOUND` `BAD_JSON` `NO_ROUTE` `INTERNAL`。

## 持久化

SQLite 数据库位于项目内 `data/minkowski.db`（可用环境变量 `MINK_DB` 覆盖）。
`polygons` 表保存原始坐标、规范形式、原始下标映射与方向标记；`sums` 表保存
计算口径（`edge-vector-merge/v1`）、结果与边来源。重启后可直接读取；
同一多边形修改顶点后重新导入会生成新 id 与新报告，旧报告的来源关系保留。
失败输入不会写入数据库，也不会留下成功区域。

## 测试与核验

`npm test` 覆盖：顺/逆时针、起点轮换、相邻共线边、负坐标、凹形/共线/重复/自相交拒绝、
反向平行边极角比较、平行边合并、平移不变性，以及 30 组随机小夹具上
“边合并结果 == 枚举顶点对+凸包参考”且“交换 A/B 后规范结果一致”。
