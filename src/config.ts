export class ApiError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

export const config = {
  port: Number(process.env.PAL_PORT ?? 0),
  maxTextLength: Number(process.env.PAL_MAX_TEXT_LEN ?? 200_000),
  maxQueryBatch: Number(process.env.PAL_MAX_BATCH ?? 1_000),
  maxExplainRecords: Number(process.env.PAL_MAX_EXPLAIN ?? 512),
  maxSnippet: Number(process.env.PAL_MAX_SNIPPET ?? 200),
  dbPath: process.env.PAL_DB_PATH ?? "data/palindrome.db",
  algoVersion: "manacher-1.0.0",
};

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

export function validateText(text: unknown): string {
  if (typeof text !== "string") throw new ApiError("INVALID_TEXT", "text 必须是字符串");
  if (text.length > config.maxTextLength * 2) throw new ApiError("TEXT_TOO_LONG", `文本超过长度上限 ${config.maxTextLength} 码点`);
  if (LONE_SURROGATE.test(text)) throw new ApiError("LONE_SURROGATE", "文本包含孤立代理项（lone surrogate）");
  const cps = Array.from(text);
  if (cps.length > config.maxTextLength) throw new ApiError("TEXT_TOO_LONG", `文本超过长度上限 ${config.maxTextLength} 码点`);
  return text;
}

export function toCodePoints(text: string): string[] {
  return Array.from(text);
}

export function buildCpToUtf16(cps: string[]): number[] {
  const map = new Array<number>(cps.length + 1);
  map[0] = 0;
  for (let i = 0; i < cps.length; i++) map[i + 1] = map[i] + cps[i].length;
  return map;
}

export function validateInterval(a: unknown, b: unknown, n: number): [number, number] {
  if (typeof a !== "number" || typeof b !== "number" || !Number.isInteger(a) || !Number.isInteger(b)) {
    throw new ApiError("INVALID_INTERVAL", "区间端点必须是整数");
  }
  if (a < 0 || b < 0 || b > n) throw new ApiError("INTERVAL_OUT_OF_RANGE", `区间越界，合法范围 [0, ${n}]`);
  if (a > b) throw new ApiError("INVALID_INTERVAL", "起点不能大于终点");
  return [a, b];
}

export function truncate(s: string, max: number): { text: string; truncated: boolean } {
  const cps = Array.from(s);
  if (cps.length <= max) return { text: s, truncated: false };
  return { text: cps.slice(0, max).join(""), truncated: true };
}
