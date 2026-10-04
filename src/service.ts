import { Store, type VersionRow, ALGO_VERSION } from "./db.js";
import { isPalindromeInterval } from "./manacher.js";
import { sliceByPoints } from "./unicode.js";
import { ApiError, type Config } from "./errors.js";

export class PalService {
  constructor(public store: Store, public cfg: Config) {}

  importText(docId: number | null, text: unknown): VersionRow {
    return this.store.importText(docId, text, this.cfg.maxTextLength, this.cfg.explainCap);
  }

  resolveVersion(docId: number, versionId?: number): VersionRow {
    if (versionId === undefined) return this.store.getCurrentVersion(docId);
    const v = this.store.getVersion(versionId);
    if (v.docId !== docId) throw new ApiError("ERR_NOT_FOUND", "该版本不属于此文档", 404);
    return v;
  }

  /** 校验并规范化一个码点下标（必须是安全整数）。 */
  private asIndex(value: unknown, name: string): number {
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
      value = Number(value);
    }
    if (typeof value !== "number" || !Number.isSafeInteger(value)) {
      throw new ApiError("ERR_BAD_INDEX", `${name} 必须是整数索引`);
    }
    return value;
  }

  checkInterval(v: VersionRow, start: unknown, end: unknown) {
    const s = this.asIndex(start, "start");
    const e = this.asIndex(end, "end");
    if (s < 0 || e < 0 || s > v.length || e > v.length) {
      throw new ApiError("ERR_INDEX_OUT_OF_RANGE", `区间 [${s},${e}) 越界（长度 ${v.length}）`);
    }
    if (s > e) throw new ApiError("ERR_START_GT_END", `起点 ${s} 大于终点 ${e}`);
    return { start: s, end: e, palindrome: isPalindromeInterval(v.odd, v.even, s, e), length: e - s };
  }

  queryBatch(v: VersionRow, intervals: unknown) {
    if (!Array.isArray(intervals)) throw new ApiError("ERR_BAD_REQUEST", "intervals 必须是数组");
    if (intervals.length > this.cfg.maxBatch) {
      throw new ApiError("ERR_BATCH_TOO_LARGE", `批量查询数量超过上限 ${this.cfg.maxBatch}`);
    }
    return intervals.map((it) => {
      if (!it || typeof it !== "object") throw new ApiError("ERR_BAD_REQUEST", "区间必须是对象");
      const o = it as { start?: unknown; end?: unknown };
      return this.checkInterval(v, o.start, o.end);
    });
  }

  fragment(v: VersionRow, start: unknown, end: unknown) {
    const s = this.asIndex(start, "start");
    const e = this.asIndex(end, "end");
    if (s < 0 || e < 0 || s > v.length || e > v.length) {
      throw new ApiError("ERR_INDEX_OUT_OF_RANGE", `区间 [${s},${e}) 越界`);
    }
    if (s > e) throw new ApiError("ERR_START_GT_END", `起点 ${s} 大于终点 ${e}`);
    const len = e - s;
    let text = sliceByPoints(v.decoded, s, e);
    let truncated = false;
    if (len > this.cfg.maxFragment) {
      const cut = s + this.cfg.maxFragment;
      text = sliceByPoints(v.decoded, s, cut);
      truncated = true;
    }
    // 码点偏移与 UTF-16 偏移双映射
    const utf16Start = v.decoded.map[s] ?? v.raw.length;
    const utf16End = e < v.length ? v.decoded.map[e]! : v.raw.length;
    return {
      start: s,
      end: e,
      length: len,
      text,
      utf16: { start: utf16Start, end: utf16End },
      truncated,
    };
  }

  radiusView(v: VersionRow, parity: unknown, offset: unknown, limit: unknown) {
    if (parity !== "odd" && parity !== "even") {
      throw new ApiError("ERR_BAD_PARITY", "parity 必须是 odd 或 even");
    }
    const arr = parity === "odd" ? v.odd : v.even;
    const off = offset === undefined || offset === null ? 0 : this.asIndex(offset, "offset");
    const lim = limit === undefined || limit === null ? 50 : this.asIndex(limit, "limit");
    if (off < 0 || off > arr.length) throw new ApiError("ERR_INDEX_OUT_OF_RANGE", "offset 越界");
    if (lim < 0) throw new ApiError("ERR_BAD_INDEX", "limit 不能为负");
    const realLim = Math.min(lim, 2000);
    const values: number[] = [];
    for (let i = off; i < Math.min(arr.length, off + realLim); i++) values.push(arr[i]!);
    return { parity, offset: off, limit: realLim, total: arr.length, values };
  }

  report(v: VersionRow) {
    return {
      docId: v.docId,
      versionId: v.id,
      version: v.version,
      algoVersion: ALGO_VERSION,
      length: v.length,
      longestLength: v.longestLength,
      longestCount: v.longest.length,
      longest: v.longest,
      totalPalindromes: v.total,
      explainCount: v.explain.length,
      explainTruncated: v.explainTruncated,
      createdAt: v.createdAt,
    };
  }
}
