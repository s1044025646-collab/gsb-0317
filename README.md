# Manacher 回文区间与镜像半径解释后端

单文档回文分析服务：TypeScript + Node.js + SQLite（`node:sqlite` 内置模块，无原生编译依赖），仅提供 HTTP API 与 CLI，无网页界面。Windows 本地直接运行，不依赖 Docker / WSL / 外部服务。

## 功能

- 导入 Unicode 文本并构建分析（每次导入生成新版本，旧版本原文与报告保留）
- 自行实现的 Manacher 算法：奇数半径 `d1`（含中心字符）与偶数半径 `d2`（中心位于两字符之间），镜像复用 + 最右边界推进，线性时间
- 最长连续回文长度与全部并列起止区间（按起点排序）
- 非空回文出现总数（同一内容在不同位置分别计数，十进制整数字符串）
- 区间 `[start, end)` 是否回文：基于已构建半径 O(1) 回答，不重新扫描
- 位置以 Unicode 码点计数，并提供到 JavaScript UTF-16 偏移的映射（可双向提取原文）
- 小样本记录每个中心的镜像位置、初始可复用半径、实际新增比较次数与最右边界变化
- 长文本截短解释明细与返回片段，但完整保留位置与总数（截短仅影响展示）

## 回文定义

按字符（码点）顺序正反相同；不忽略空白、标点、大小写，不做 Unicode 归一化，不识别重复片段、子序列或语义相似。空串最长长度与总数均为 0；合法空区间 `[a, a)` 判为回文但不计入非空总数。

## 半径数组约定

- `d1[i]`：以码点 `i` 为中心的奇数半径（含中心），对应区间 `[i-d1[i]+1, i+d1[i])`，长度 `2*d1[i]-1`
- `d2[i]`：以码点 `i-1` 与 `i` 之间为中心的偶数半径，对应区间 `[i-d2[i], i+d2[i])`，长度 `2*d2[i]`
- 当前中心在最右回文内时，初始半径取 `min(镜像半径, 到右边界的距离)`，仅对未确定部分逐字符比较

## 快速开始

```powershell
npm install        # 安装 TypeScript 等开发依赖
npm run build      # 编译到 dist/
npm test           # 构建并运行全部测试
npm start          # 启动 API 服务（默认自动选择空闲端口）
npm run demo       # 运行内置演示（abacaba / abba / 无重复 / 全相同 / 表情 / 中文）
```

## CLI

```powershell
node dist/src/cli.js import -t "abacaba"     # 或直接给文件路径: import sample.txt
node dist/src/cli.js list                    # 列出全部版本（重启后仍可查询）
node dist/src/cli.js radii <id> [中心] [数量] # 中心半径表（含镜像/复用/新增比较）
node dist/src/cli.js query <id> <s> <e>      # 区间 [s,e) 是否回文
node dist/src/cli.js longest <id>            # 最长回文与全部并列区间
node dist/src/cli.js extract <id> <s> <e> [--utf16]
node dist/src/cli.js report <id>             # JSON 报告
```

## HTTP API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/documents` | 导入 `{"text": "..."}` 并构建分析 |
| GET | `/documents` | 列出全部版本 |
| GET | `/documents/:id/radii?center=&count=` | 半径切片与解释记录 |
| POST | `/documents/:id/query` | `{"intervals": [[s,e],...]}` 批量区间查询 |
| GET | `/documents/:id/longest` | 最长长度、并列区间、总数 |
| GET | `/documents/:id/extract?start=&end=&offset=cp|utf16` | 按码点或 UTF-16 偏移提取原文 |
| GET | `/documents/:id/report` | 完整报告（JSON） |
| GET | `/documents/:id/explain` | 镜像复用解释明细 |

错误统一返回 `{"error": {"code", "message"}}`，错误码包括：`INVALID_TEXT`、`LONE_SURROGATE`、`TEXT_TOO_LONG`、`INVALID_INTERVAL`、`INTERVAL_OUT_OF_RANGE`、`BATCH_TOO_LARGE`、`NOT_FOUND`、`INCOMPLETE_INDEX`、`COMPUTE_FAILED`。

## 配置（环境变量）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PAL_PORT` | `0`（自动选空闲端口） | API 监听端口 |
| `PAL_DB_PATH` | `data/palindrome.db` | SQLite 数据库路径（项目内数据目录） |
| `PAL_MAX_TEXT_LEN` | `200000` | 文本码点长度上限 |
| `PAL_MAX_BATCH` | `1000` | 单次批量查询区间数上限 |
| `PAL_MAX_EXPLAIN` | `512` | 解释记录条数上限 |
| `PAL_MAX_SNIPPET` | `200` | 返回片段码点上限 |

## 持久化

SQLite 保存原文、码点→UTF-16 映射、算法版本（`manacher-1.0.0`）、奇偶半径数组、最长区间、总数与解释记录。每次导入创建新版本行，旧报告仍指向旧原文；只有计算成功才将记录置为 `complete`，计算失败不会登记为完整索引。

## 测试

`npm test` 覆盖：空串、单字符、表情、组合附加符、中文、多个并列最长、整文档回文；随机小样本与独立朴素枚举交叉核对最长位置、总数与全部区间查询；逐中心验证半径边界内对称、向外一步越界或不等；表情文本按码点与 UTF-16 两种偏移取回相同原文；关闭并重建 Store 后旧分析仍可读取。

## 限制

- 单文档分析，不支持跨文档检索
- 组合附加符按码点独立比较（如 `é` 的两种 Unicode 表示不视为相同），不做归一化
- 文本长度受 `PAL_MAX_TEXT_LEN` 限制（默认 20 万码点）
- `node:sqlite` 目前为 Node 实验特性（启动时有 ExperimentalWarning），需要 Node.js 22.5+，建议 Node 24+
