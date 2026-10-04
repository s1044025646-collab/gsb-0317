# Manacher 回文区间与镜像半径解释后端

单文档回文分析服务：输入 Unicode 文本，返回**最长连续回文**、**全部并列最长位置**、**非空回文出现总数**，并能基于已构建半径**O(1) 判断任意区间是否回文**。仅提供 HTTP API 与 CLI，不含网页界面。

- 语言/运行时：TypeScript + Node.js（已在 Node v25.5.0 / Windows 验证）
- 存储：Node 内置 `node:sqlite`（无需原生编译，无需 Docker / WSL / 外部服务）
- 算法：**自行实现**的 Manacher，奇数、偶数半径分别计算，带镜像复用解释

## 回文定义（严格）

- 按 Unicode **码点**顺序，正反完全相同才算回文。
- **不忽略**空白、标点、大小写；**不做** Unicode 归一化；组合附加符是独立码点。
- 重复片段、子序列、语义相似均**不算**回文。
- 位置以码点计数（左闭右开 `[start,end)`），同时提供到 JavaScript UTF-16 偏移的映射。
- 空串最长长度与总数均为 0；合法空区间判为回文，但不计入非空总数。

## 算法与索引公式

设码点数组为 `s`，长度 `n`。

- **奇数半径** `odd[i]`（中心为字符 `i`，半径包含中心字符，`odd[i] >= 1`）：
  - 回文左闭右开区间：`[i - odd[i] + 1, i + odd[i])`，长度 `2*odd[i]-1`。
- **偶数半径** `even[i]`（中心位于字符 `i-1` 与 `i` **之间**的间隙，`even[i] >= 0`）：
  - 回文左闭右开区间：`[i - even[i], i + even[i])`，长度 `2*even[i]`。

**镜像复用（线性关键）**：维护覆盖到最右侧的已知回文边界。当中心落在其内部时，初始半径取“镜像中心半径”和“到右边界距离”的**较小值**直接复用，随后**只比较尚未确定的字符**，并在越过旧边界时推进最右边界。整体 O(n)，不是对每个中心都从头展开。

- 非空回文出现总数 = `sum(odd) + sum(even)`（相同内容在不同位置分别计数；用十进制字符串返回，避免大整数精度问题）。
- 区间判断：奇数长度用对应中心字符的 `odd` 半径，偶数长度用对应间隙的 `even` 半径，**直接查半径表**，不重新扫描文档。
- 解释明细记录：中心、镜像位置、初始可复用半径、新增比较次数、成功匹配数、最终半径及边界变化。

## 快速开始

```powershell
npm install
npm run build      # 编译到 dist/
npm test           # 构建并运行 node:test 测试
npm run demo       # CLI + HTTP 端到端演示（含重启持久化）
npm start          # 启动 HTTP 服务（默认自动选择空闲端口）
```

启动后控制台会打印实际监听地址，例如 `http://127.0.0.1:51234`。指定端口：

```powershell
$env:PORT=8080; npm start
```

## CLI

CLI 会在数据目录保存“当前文档”记忆（`cli-state.json`），**重启后无需重新导入**即可继续查询。

```powershell
node dist/src/main.js import --text "abacaba"      # 导入并构建（也可 --file 路径）
node dist/src/main.js analyze                      # 最长回文与总数（对当前文档）
node dist/src/main.js radius --parity both         # 中心半径小表格 odd|even|both
node dist/src/main.js query --start 0 --end 3      # 区间是否回文（基于半径）
node dist/src/main.js fragment --start 2 --end 5   # 提取原文 + UTF-16 偏移
node dist/src/main.js explain                      # 镜像复用解释明细
node dist/src/main.js versions                     # 文档的全部历史版本
node dist/src/main.js report                       # 导出 JSON 报告
node dist/src/main.js import --doc 1 --text "..."  # 向文档 1 追加新版本
node dist/src/main.js query --doc 1 --version 3 --start 0 --end 2  # 读旧版本
```

## HTTP API

所有响应为 JSON；错误形如 `{"error":{"code":"...","message":"..."}}`。版本可通过 `?version=<版本ID>` 指定，默认当前版本。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/documents` | body `{"text":"..."}` 新建文档并分析 |
| POST | `/api/documents/:id` | 为已有文档创建新版本（旧版本保留） |
| GET  | `/api/documents/:id` | 完整报告 |
| GET  | `/api/documents/:id/versions` | 版本列表 |
| GET  | `/api/documents/:id/longest` | 最长长度、全部最长区间、总数 |
| GET  | `/api/documents/:id/radius?parity=odd&offset=0&limit=50` | 分页查看半径 |
| POST | `/api/documents/:id/query` | `{start,end}` 单查，或 `{intervals:[...]}` 批量 |
| POST | `/api/documents/:id/fragment` | `{start,end}` 提取原文及 UTF-16 偏移 |
| GET  | `/api/documents/:id/explain` | 镜像复用解释明细 |
| GET  | `/health` | 健康检查 |

示例：

```powershell
curl.exe -X POST http://127.0.0.1:8080/api/documents -H "content-type: application/json" -d '{\"text\":\"abba\"}'
curl.exe "http://127.0.0.1:8080/api/documents/1/radius?parity=even"
curl.exe -X POST http://127.0.0.1:8080/api/documents/1/query -H "content-type: application/json" -d '{\"start\":0,\"end\":3}'
```

## 错误码

| code | 含义 |
| --- | --- |
| `ERR_LONE_SURROGATE` | 文本含孤立高/低代理项，无法映射码点 |
| `ERR_NOT_STRING` | `text` 不是字符串 |
| `ERR_TEXT_TOO_LONG` | 超过最大码点长度 |
| `ERR_NOT_FOUND` | 文档/版本不存在（HTTP 404） |
| `ERR_BAD_INDEX` | 索引不是安全整数 |
| `ERR_INDEX_OUT_OF_RANGE` | 索引为负或超出文本长度 |
| `ERR_START_GT_END` | 区间起点大于终点 |
| `ERR_BATCH_TOO_LARGE` | 批量查询数量超上限 |
| `ERR_BAD_PARITY` | parity 非 odd/even |
| `ERR_BAD_REQUEST` | 请求体/参数格式错误 |
| `ERR_CORRUPT_INDEX` | 版本不是完整索引 |
| `ERR_INTERNAL` | 未预期内部错误（HTTP 500） |

## 数据与版本

- 数据目录默认项目内 `data/`，数据库 `data/palindrome.db`（SQLite，WAL 模式）。
- 保存原文、码点数组、码点→UTF-16 映射、算法版本号、奇偶半径、最长结果、解释明细。
- 改动文本创建**新版本**；文档的 `current_version_id` 指向最新版，但旧报告仍可通过版本 ID 读取旧原文与旧半径。
- 导入在单事务内完成：解码/计算抛错时**不会**登记新版本或半成品索引。

## 配置（环境变量）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `0` | HTTP 端口，`0` = 自动选空闲端口 |
| `PAL_DATA_DIR` | `data` | 数据目录 |
| `PAL_MAX_TEXT_LENGTH` | `1000000` | 最大码点长度 |
| `PAL_MAX_BATCH` | `1000` | 区间批量查询上限 |
| `PAL_EXPLAIN_CAP` | `200` | 解释明细保留中心数上限 |
| `PAL_MAX_FRAGMENT` | `2000` | 片段返回最大码点数（超长截断并标记） |

> 截断只影响**展示明细/片段大小**；半径数组、全部最长区间与总数始终基于完整文本计算。

## 测试

`tests/pal.test.ts` 覆盖：

- `abacaba`、`abba`、无重复短串、全相同字符的奇偶中心差异。
- 空串、单字符、表情（码点 vs UTF-16）、组合附加符、中文、多个并列最长、整篇回文。
- 小样本用**独立朴素枚举**枚举所有非空区间，核对最长位置、总数与全部区间查询。
- 逐个中心验证半径：边界内对称成立，再向外一步即越界或不相等。
- 表情文本按码点区间与 UTF-16 区间取回相同原文。
- 关闭并重新打开数据库后，旧版本仍可读、新版本正确追加。
- 越界、起点大于终点、非整数索引、孤立代理项等错误码。

## 项目结构

```
src/
  unicode.ts    码点解码、孤立代理项拒绝、码点↔UTF-16 映射
  manacher.ts   Manacher 奇偶半径、镜像复用解释、区间判定、最长/总数汇总
  db.ts         node:sqlite 版本化存储
  service.ts    校验与查询服务
  server.ts     HTTP API
  cli.ts        命令行
  main.ts       入口（serve / 子命令）
tests/          node:test 测试
scripts/demo.mjs 端到端演示
```

## 限制与假设

- 单文档模型；不做跨文档检索、网页或高亮编辑器，只返回文本与数值。
- 回文判定基于码点相等，刻意不做大小写折叠、空白/标点忽略、NFKC 等归一化。
- `node:sqlite` 在当前 Node 版本带实验性警告（stderr），功能正常。
- 总量可能很大，接口以十进制**字符串**返回（内部用 BigInt 统计）。
