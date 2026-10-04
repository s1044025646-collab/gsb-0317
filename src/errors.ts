export type ErrorCode =
  | "ERR_LONE_SURROGATE"
  | "ERR_NOT_STRING"
  | "ERR_TEXT_TOO_LONG"
  | "ERR_NOT_FOUND"
  | "ERR_BAD_INDEX"
  | "ERR_INDEX_OUT_OF_RANGE"
  | "ERR_START_GT_END"
  | "ERR_BATCH_TOO_LARGE"
  | "ERR_BAD_PARITY"
  | "ERR_BAD_REQUEST"
  | "ERR_INTERNAL"
  | "ERR_CORRUPT_INDEX";

export class ApiError extends Error {
  code: ErrorCode;
  status: number;
  constructor(code: ErrorCode, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export interface Config {
  /** 允许导入的最大码点长度。 */
  maxTextLength: number;
  /** 单次区间查询批量上限。 */
  maxBatch: number;
  /** 解释明细保留中心数量上限。 */
  explainCap: number;
  /** 提取片段返回的最大码点数。 */
  maxFragment: number;
  /** 数据目录。 */
  dataDir: string;
  /** HTTP 端口；0 表示选择空闲端口。 */
  port: number;
}

export function loadConfig(): Config {
  const num = (v: string | undefined, d: number) => {
    if (v === undefined || v === "") return d;
    const x = Number(v);
    return Number.isFinite(x) && x >= 0 ? x : d;
  };
  return {
    maxTextLength: num(process.env.PAL_MAX_TEXT_LENGTH, 1_000_000),
    maxBatch: num(process.env.PAL_MAX_BATCH, 1000),
    explainCap: num(process.env.PAL_EXPLAIN_CAP, 200),
    maxFragment: num(process.env.PAL_MAX_FRAGMENT, 2000),
    dataDir: process.env.PAL_DATA_DIR || "data",
    port: num(process.env.PORT, 0),
  };
}
