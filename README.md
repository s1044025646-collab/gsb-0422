# 凸多边形 Minkowski 和与边向量合并核验后端

纯后端服务（API + CLI），计算两个平面凸多边形的 Minkowski 和，输出结果区域边界，并解释每条结果边来自哪条输入边。核心构造使用**有序边向量合并（角度扫描）**，不枚举顶点对、不调用凸包库；凸包与暴力枚举仅作为独立核验手段存在。

## 范围与限制

- 仅处理**简单凸多边形**：至少 3 个不共线顶点，按边界顺序给出（顺/逆时针均可）。
- 不支持：孔洞、非凸区域、曲线、三维多面体、路径规划。
- 结果**不**构成任何实际机器人的碰撞安全保证。
- 坐标为整数，绝对值 ≤ 1,000,000；每个多边形顶点数 ≤ 256。加法、叉积、面积累积均在 IEEE 754 双精度精确整数范围内（远低于 2^53）。
- 接受的输入容差：末尾重复首点作为闭合标记、顺时针输入、相邻共线中间点（规范化时去除）。
- 明确拒绝：其他重复顶点、自相交、凹多边形、全部共线、非整数或越界坐标。非法输入在发布结果前被拒绝，不会静默取凸包改写问题，也不会覆盖已存数据。

## 计算口径

1. 规范化：统一为逆时针；去除可约的相邻共线中间点；起点取最低 y、再最低 x 的顶点。每个规范顶点保留其**原始输入顶点编号**，来源关系可追溯。
2. 两边各自生成按绕行顺序排列的边向量序列。
3. 按极角合并：先按半平面分组再按叉积符号比较，正确处理跨角度零点；同向平行边（叉积为 0 且点积为正）相加并同时推进两个序列；反向平行边**不会**被当作同向合并。
4. 输出起点 = 两个规范起点之和，依次累加合并后的向量；去除零长度边与冗余共线点；顶点序列不重复闭合点；累加后必须回到起点，否则报错。
5. 每条结果边记录 1 或 2 个来源（`{polygon: "A"|"B", edge: 原始顶点编号}`）。

## 环境要求

- Windows 本地，Node.js ≥ 22.5（使用内置 `node:sqlite` 与 `node:http`，无原生依赖）。
- 不依赖 Docker、WSL、付费服务或外部在线 API。运行时零第三方依赖；仅开发依赖 `typescript` 与 `@types/node`。

## 构建、测试、启动、演示

```powershell
npm install        # 安装开发依赖
npm run build      # 编译 TypeScript 到 dist/
npm test           # 构建并运行全部测试（node:test）
npm start          # 启动 API 服务（默认自动选择空闲端口）
npm run demo       # 内置演示：2x1 矩形 + 3x2 矩形 = 5x3 矩形；三角形 + 顺时针凸四边形
```

指定端口：`node dist/src/cli.js serve --port=8080`。数据库文件默认在项目内 `data/minkowski.db`（可用环境变量 `MINKOWSKI_DB` 覆盖），重启后可读取。

## CLI

```
node dist/src/cli.js serve [--port=N]           启动 API 服务
node dist/src/cli.js import <file> [name]       导入多边形（JSON 顶点数组）
node dist/src/cli.js validate <file>            仅校验并规范化
node dist/src/cli.js sum <aId> <bId>            计算 Minkowski 和并生成报告
node dist/src/cli.js report <id>                查看报告（顶点 + 边来源 + 独立检查）
node dist/src/cli.js verify <reportId> <file>   核验外部结果
node dist/src/cli.js translate-check <reportId> <dx> <dy>  平移核验
node dist/src/cli.js export <reportId> <out>    导出报告 JSON
node dist/src/cli.js list                       列出多边形与报告
node dist/src/cli.js demo                       运行内置演示
```

顶点文件格式：`[{"x":0,"y":0},{"x":2,"y":0},{"x":2,"y":1},{"x":0,"y":1}]`

## HTTP API

所有响应均为 JSON；错误响应形如 `{"code": "NON_CONVEX", "message": "..."}`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 健康检查 |
| POST | `/validate` | 校验 `{vertices}`，返回规范形式 |
| POST | `/polygons` | 导入 `{vertices, name?}`，返回 `id` |
| GET | `/polygons` 、 `/polygons/:id` | 查询 |
| POST | `/sum` | `{aId, bId}` 或 `{a, b}`（顶点数组），计算并存储报告 |
| GET | `/reports/:id` | 查询报告（含边来源与独立凸性/极值检查） |
| GET | `/reports/:id/export` | 导出报告 JSON（附件） |
| POST | `/verify` | `{reportId, candidate}` 核验外部结果 |
| POST | `/verify-translation` | `{reportId, dx, dy}` 平移核验（两输入各平移 (dx,dy)，和应平移 (2dx,2dy)） |

### 错误码

`INVALID_SHAPE`、`INVALID_VERTEX_COUNT`、`NON_INTEGER`、`OUT_OF_RANGE`、`DUPLICATE_VERTEX`、`COLLINEAR_ALL`、`NON_CONVEX`、`INVALID_JSON`、`MISSING_PARAM`、`NOT_FOUND`、`INTERNAL_NOT_CLOSED`。

## 演示说明

`npm run demo` 展示：

1. 宽 2 高 1 轴对齐矩形 + 宽 3 高 2 矩形 = 宽 5 高 3 矩形；四条结果边均为同向平行边合并，每条边同时记录 A、B 两个来源。
2. 三角形 + 顺时针输入的凸四边形（含负坐标、非规范起点），输出 7 条边及各自来源。
3. 平移核验：输入平移后重新求和，验证输出仅相应平移。

## 测试与核验

`npm test` 覆盖：顺/逆时针、起点轮换、相邻共线边、负坐标、闭合标记、非法凹形/共线/重复点/越界、反向平行边与跨零点极角比较、随机小夹具上"边合并 == 暴力枚举顶点对取凸包"、交换 A/B 一致性、平移一致性、SQLite 持久化与失败输入不污染数据、HTTP API 端到端。

独立核验方法（凸包、凸性/闭合/极值检查）在 `src/geometry.ts` 中与核心构造分离，正式求解路径只走边向量合并。
