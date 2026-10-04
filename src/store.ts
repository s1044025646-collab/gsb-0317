import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { manacher, longestPalindromes, totalPalindromeCount, isPalindromeRange, ExplainRecord, LongestResult } from "./manacher";
import { ApiError, config, validateText, toCodePoints, buildCpToUtf16, validateInterval, truncate } from "./config";

export interface AnalysisRow {
  id: number;
  text: string;
  algoVersion: string;
  createdAt: string;
  cpCount: number;
  cpToUtf16: number[];
  d1: number[];
  d2: number[];
  longestLength: number;
  longestIntervals: Array<[number, number]>;
  totalCount: string;
  explains: ExplainRecord[];
  explainTruncated: boolean;
}

export class Store {
  private db: DatabaseSync;

  constructor(dbPath: string = config.dbPath) {
    if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS analyses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        text TEXT NOT NULL,
        algo_version TEXT NOT NULL,
        created_at TEXT NOT NULL,
        cp_count INTEGER NOT NULL,
        cp_to_utf16 TEXT NOT NULL,
        d1 TEXT NOT NULL,
        d2 TEXT NOT NULL,
        longest_length INTEGER NOT NULL,
        longest_intervals TEXT NOT NULL,
        total_count TEXT NOT NULL,
        explains TEXT NOT NULL,
        explain_truncated INTEGER NOT NULL,
        status TEXT NOT NULL
      );
    `);
  }

  close(): void { this.db.close(); }

  buildAnalysis(rawText: unknown): AnalysisRow {
    const text = validateText(rawText);
    const cps = toCodePoints(text);
    const cpToUtf16 = buildCpToUtf16(cps);

    const insert = this.db.prepare(`
      INSERT INTO analyses (text, algo_version, created_at, cp_count, cp_to_utf16, d1, d2,
        longest_length, longest_intervals, total_count, explains, explain_truncated, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'building')
    `);

    let computed: { d1: number[]; d2: number[]; explains: ExplainRecord[] };
    let longest: LongestResult;
    let total: bigint;
    try {
      computed = manacher(cps, config.maxExplainRecords);
      longest = longestPalindromes(computed.d1, computed.d2);
      total = totalPalindromeCount(computed.d1, computed.d2);
    } catch (err) {
      throw new ApiError("COMPUTE_FAILED", `分析计算失败: ${(err as Error).message}`, 500);
    }

    const explainTruncated = cps.length * 2 > config.maxExplainRecords;
    const result = insert.run(
      text, config.algoVersion, new Date().toISOString(), cps.length,
      JSON.stringify(cpToUtf16), JSON.stringify(computed.d1), JSON.stringify(computed.d2),
      longest.length, JSON.stringify(longest.intervals), total.toString(),
      JSON.stringify(computed.explains), explainTruncated ? 1 : 0
    );
    const id = Number(result.lastInsertRowid);
    this.db.prepare(`UPDATE analyses SET status = 'complete' WHERE id = ?`).run(id);
    return this.get(id);
  }

  get(id: number): AnalysisRow {
    const row = this.db.prepare(`SELECT * FROM analyses WHERE id = ?`).get(id) as any;
    if (!row) throw new ApiError("NOT_FOUND", `分析 ${id} 不存在`, 404);
    if (row.status !== "complete") throw new ApiError("INCOMPLETE_INDEX", `分析 ${id} 未完整建立`, 409);
    return {
      id: row.id,
      text: row.text,
      algoVersion: row.algo_version,
      createdAt: row.created_at,
      cpCount: row.cp_count,
      cpToUtf16: JSON.parse(row.cp_to_utf16),
      d1: JSON.parse(row.d1),
      d2: JSON.parse(row.d2),
      longestLength: row.longest_length,
      longestIntervals: JSON.parse(row.longest_intervals),
      totalCount: row.total_count,
      explains: JSON.parse(row.explains),
      explainTruncated: row.explain_truncated === 1,
    };
  }

  list(): Array<{ id: number; createdAt: string; cpCount: number; longestLength: number; totalCount: string; preview: string }> {
    const rows = this.db.prepare(`SELECT id, created_at, cp_count, longest_length, total_count, text FROM analyses WHERE status='complete' ORDER BY id`).all() as any[];
    return rows.map(r => ({
      id: r.id, createdAt: r.created_at, cpCount: r.cp_count,
      longestLength: r.longest_length, totalCount: r.total_count,
      preview: truncate(r.text, 40).text,
    }));
  }

  queryIntervals(id: number, intervals: unknown): Array<{ start: number; end: number; palindrome: boolean }> {
    const a = this.get(id);
    if (!Array.isArray(intervals) || intervals.length === 0) throw new ApiError("INVALID_INTERVAL", "intervals 必须是非空数组");
    if (intervals.length > config.maxQueryBatch) throw new ApiError("BATCH_TOO_LARGE", `批量查询上限 ${config.maxQueryBatch}`);
    return intervals.map((pair) => {
      if (!Array.isArray(pair) || pair.length !== 2) throw new ApiError("INVALID_INTERVAL", "每个区间必须是 [start, end]");
      const [s, e] = validateInterval(pair[0], pair[1], a.cpCount);
      return { start: s, end: e, palindrome: isPalindromeRange(a.d1, a.d2, s, e) };
    });
  }

  extract(id: number, start: unknown, end: unknown, offset: "cp" | "utf16"): { text: string; cpStart: number; cpEnd: number; utf16Start: number; utf16End: number } {
    const a = this.get(id);
    let cpStart: number, cpEnd: number;
    if (offset === "utf16") {
      if (typeof start !== "number" || typeof end !== "number" || !Number.isInteger(start) || !Number.isInteger(end)) {
        throw new ApiError("INVALID_INTERVAL", "区间端点必须是整数");
      }
      const idxS = a.cpToUtf16.indexOf(start);
      const idxE = a.cpToUtf16.indexOf(end);
      if (idxS < 0 || idxE < 0) throw new ApiError("INVALID_INTERVAL", "UTF-16 偏移未落在码点边界上");
      cpStart = idxS; cpEnd = idxE;
      validateInterval(cpStart, cpEnd, a.cpCount);
    } else {
      [cpStart, cpEnd] = validateInterval(start, end, a.cpCount);
    }
    const cps = toCodePoints(a.text);
    return {
      text: cps.slice(cpStart, cpEnd).join(""),
      cpStart, cpEnd,
      utf16Start: a.cpToUtf16[cpStart],
      utf16End: a.cpToUtf16[cpEnd],
    };
  }

  report(id: number) {
    const a = this.get(id);
    const longestSamples = a.longestIntervals.slice(0, 20).map(([s, e]) => ({
      start: s, end: e,
      utf16Start: a.cpToUtf16[s], utf16End: a.cpToUtf16[e],
      snippet: truncate(toCodePoints(a.text).slice(s, e).join(""), config.maxSnippet),
    }));
    return {
      id: a.id,
      algoVersion: a.algoVersion,
      createdAt: a.createdAt,
      cpCount: a.cpCount,
      utf16Length: a.text.length,
      longestLength: a.longestLength,
      longestIntervalCount: a.longestIntervals.length,
      longestSamples,
      longestTruncated: a.longestIntervals.length > longestSamples.length,
      totalCount: a.totalCount,
      explainRecordCount: a.explains.length,
      explainTruncated: a.explainTruncated,
    };
  }
}
