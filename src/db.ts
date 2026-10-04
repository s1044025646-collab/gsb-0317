import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { decodeText, type DecodedText } from "./unicode.js";
import { runManacher, type ExplainRecord } from "./manacher.js";
import { ApiError } from "./errors.js";

export const ALGO_VERSION = "manacher-ts-1.0.0";

export interface Interval {
  start: number;
  end: number;
}

export interface VersionRow {
  id: number;
  docId: number;
  version: number;
  raw: string;
  decoded: DecodedText;
  length: number;
  odd: Int32Array;
  even: Int32Array;
  total: string;
  longestLength: number;
  longest: Interval[];
  explain: ExplainRecord[];
  explainTruncated: boolean;
  algoVersion: string;
  createdAt: string;
}

export class Store {
  db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        current_version_id INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        doc_id INTEGER NOT NULL,
        version INTEGER NOT NULL,
        raw TEXT NOT NULL,
        points BLOB NOT NULL,
        map TEXT NOT NULL,
        units BLOB NOT NULL,
        length INTEGER NOT NULL,
        odd BLOB NOT NULL,
        even BLOB NOT NULL,
        total TEXT NOT NULL,
        longest_length INTEGER NOT NULL,
        longest TEXT NOT NULL,
        explain TEXT NOT NULL,
        explain_truncated INTEGER NOT NULL,
        algo_version TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(doc_id, version)
      );
    `);
  }

  /**
   * 导入文本并构建分析。计算与写入在同一事务内；
   * 若解码或计算抛错，则不会登记任何新版本。
   */
  importText(docId: number | null, raw: unknown, maxTextLength: number, explainCap: number): VersionRow {
    if (typeof raw !== "string") throw new ApiError("ERR_NOT_STRING", "text 必须是字符串");
    if ([...raw].length > maxTextLength) {
      throw new ApiError("ERR_TEXT_TOO_LONG", `文本超过最大码点长度 ${maxTextLength}`);
    }
    const decoded = decodeText(raw); // 孤立代理项在此抛出
    const result = runManacher(decoded.points, { explainCap });

    const tx = this.db.prepare("BEGIN IMMEDIATE");
    try {
      tx.run();
      let id = docId;
      let version = 1;
      if (id === null) {
        const info = this.db.prepare("INSERT INTO documents DEFAULT VALUES").run();
        id = Number(info.lastInsertRowid);
      } else {
        const doc = this.db.prepare("SELECT id FROM documents WHERE id = ?").get(id);
        if (!doc) throw new ApiError("ERR_NOT_FOUND", `文档 ${id} 不存在`, 404);
        const maxV = this.db
          .prepare("SELECT COALESCE(MAX(version),0) AS m FROM versions WHERE doc_id = ?")
          .get(id) as { m: number };
        version = maxV.m + 1;
      }
      const info = this.db
        .prepare(
          `INSERT INTO versions
           (doc_id,version,raw,points,map,units,length,odd,even,total,longest_length,longest,explain,explain_truncated,algo_version,status)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        )
        .run(
          id,
          version,
          decoded.raw,
          i32ToBlob(Int32Array.from(decoded.points)),
          JSON.stringify(decoded.map),
          u8ToBlob(Uint8Array.from(decoded.units)),
          decoded.points.length,
          i32ToBlob(result.odd),
          i32ToBlob(result.even),
          result.total,
          result.longestLength,
          JSON.stringify(result.longest),
          JSON.stringify(result.explain),
          result.explainTruncated ? 1 : 0,
          ALGO_VERSION,
          "complete"
        );
      const versionId = Number(info.lastInsertRowid);
      this.db.prepare("UPDATE documents SET current_version_id = ? WHERE id = ?").run(versionId, id);
      this.db.exec("COMMIT");
      return this.getVersion(versionId);
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  getCurrentVersion(docId: number): VersionRow {
    const doc = this.db.prepare("SELECT current_version_id FROM documents WHERE id = ?").get(docId) as
      | { current_version_id: number | null }
      | undefined;
    if (!doc) throw new ApiError("ERR_NOT_FOUND", `文档 ${docId} 不存在`, 404);
    if (!doc.current_version_id) throw new ApiError("ERR_NOT_FOUND", `文档 ${docId} 尚无版本`, 404);
    return this.getVersion(doc.current_version_id);
  }

  getVersion(versionId: number): VersionRow {
    const row = this.db.prepare("SELECT * FROM versions WHERE id = ?").get(versionId) as
      | Record<string, unknown>
      | undefined;
    if (!row) throw new ApiError("ERR_NOT_FOUND", `版本 ${versionId} 不存在`, 404);
    if (row.status !== "complete") {
      throw new ApiError("ERR_CORRUPT_INDEX", `版本 ${versionId} 不是完整索引`, 409);
    }
    const map = JSON.parse(row.map as string) as number[];
    const units = Array.from(asView(row.units as Uint8Array) as Uint8Array);
    const points = Array.from(toInt32(row.points as Uint8Array, row.length as number));
    return {
      id: row.id as number,
      docId: row.doc_id as number,
      version: row.version as number,
      raw: row.raw as string,
      decoded: { raw: row.raw as string, points, map, units },
      length: row.length as number,
      odd: toInt32(row.odd as Uint8Array, row.length as number),
      even: toInt32(row.even as Uint8Array, row.length as number),
      total: row.total as string,
      longestLength: row.longest_length as number,
      longest: JSON.parse(row.longest as string) as Interval[],
      explain: JSON.parse(row.explain as string) as ExplainRecord[],
      explainTruncated: row.explain_truncated === 1,
      algoVersion: row.algo_version as string,
      createdAt: row.created_at as string,
    };
  }

  listVersions(docId: number): Array<{ versionId: number; version: number; length: number; createdAt: string }> {
    const doc = this.db.prepare("SELECT id FROM documents WHERE id = ?").get(docId);
    if (!doc) throw new ApiError("ERR_NOT_FOUND", `文档 ${docId} 不存在`, 404);
    const rows = this.db
      .prepare("SELECT id, version, length, created_at FROM versions WHERE doc_id = ? ORDER BY version")
      .all(docId) as Array<{ id: number; version: number; length: number; created_at: string }>;
    return rows.map((r) => ({ versionId: r.id, version: r.version, length: r.length, createdAt: r.created_at }));
  }

  close() {
    this.db.close();
  }
}

function i32ToBlob(arr: Int32Array): Buffer {
  // 空数组时写入 4 字节占位：node:sqlite 会把零长度 BLOB 绑定为 NULL。
  return Buffer.concat([Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength), Buffer.alloc(arr.length === 0 ? 4 : 0)]);
}
function u8ToBlob(arr: Uint8Array): Buffer {
  return Buffer.concat([Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength), Buffer.alloc(arr.length === 0 ? 1 : 0)]);
}

/** 将 BLOB 视图精确拷贝到独立的 ArrayBuffer（避开 Buffer 内存池）。 */
function asView(b: Uint8Array): Uint8Array {
  const exact = new Uint8Array(b.byteLength);
  exact.set(new Uint8Array(b.buffer, b.byteOffset, b.byteLength));
  return exact;
}

function toInt32(b: Uint8Array, n: number): Int32Array {
  const bytes = asView(b);
  return new Int32Array(bytes.buffer, 0, n).slice();
}
