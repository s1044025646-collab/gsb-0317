import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { manacher, longestPalindromes, totalPalindromeCount, isPalindromeRange } from "../src/manacher";
import { Store } from "../src/store";
import { toCodePoints, buildCpToUtf16, ApiError } from "../src/config";

function naive(s: string[]) {
  const n = s.length;
  let best = 0;
  const intervals: Array<[number, number]> = [];
  let total = 0n;
  const isPal = (a: number, b: number) => {
    for (let i = a, j = b - 1; i < j; i++, j--) if (s[i] !== s[j]) return false;
    return true;
  };
  for (let a = 0; a < n; a++) for (let b = a + 1; b <= n; b++) {
    if (isPal(a, b)) {
      total++;
      const len = b - a;
      if (len > best) { best = len; intervals.length = 0; intervals.push([a, b]); }
      else if (len === best) intervals.push([a, b]);
    }
  }
  intervals.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  return { best, intervals, total, isPal };
}

function checkAgainstNaive(text: string) {
  const cps = toCodePoints(text);
  const { d1, d2 } = manacher(cps, 0);
  const naiveResult = naive(cps);
  const longest = longestPalindromes(d1, d2);
  assert.equal(longest.length, naiveResult.best, `最长长度不一致: ${text}`);
  assert.deepEqual(longest.intervals, naiveResult.intervals, `最长区间不一致: ${text}`);
  assert.equal(totalPalindromeCount(d1, d2), naiveResult.total, `总数不一致: ${text}`);
  for (let a = 0; a <= cps.length; a++) for (let b = a; b <= cps.length; b++) {
    assert.equal(isPalindromeRange(d1, d2, a, b), a === b ? true : naiveResult.isPal(a, b), `区间 [${a},${b}) 判定不一致: ${text}`);
  }
  for (let i = 0; i < cps.length; i++) {
    const k1 = d1[i];
    for (let d = 0; d < k1; d++) assert.equal(cps[i - d], cps[i + d]);
    if (i - k1 >= 0 && i + k1 < cps.length) assert.notEqual(cps[i - k1], cps[i + k1]);
    const k2 = d2[i];
    for (let d = 0; d < k2; d++) assert.equal(cps[i - 1 - d], cps[i + d]);
    if (i - k2 - 1 >= 0 && i + k2 < cps.length) assert.notEqual(cps[i - k2 - 1], cps[i + k2]);
  }
}

test("已知样例", () => {
  const { d1, d2 } = manacher(toCodePoints("abacaba"), 100);
  assert.deepEqual(d1, [1, 2, 1, 4, 1, 2, 1]);
  assert.deepEqual(d2, [0, 0, 0, 0, 0, 0, 0]);
  const e = manacher(toCodePoints("abba"), 100);
  assert.deepEqual(e.d2, [0, 0, 2, 0]);
  assert.equal(totalPalindromeCount(e.d1, e.d2), 6n);
});

test("朴素枚举交叉核对（固定样例）", () => {
  for (const t of ["abacaba", "abba", "abcdef", "aaaaa", "上海自来水来自海上", "aabbaa", "xyzzy", "🙂a🙂", "e\u0301e\u0301x"])
    checkAgainstNaive(t);
});

test("朴素枚举交叉核对（随机小样本）", () => {
  const alphabet = ["a", "b", "c", "🙂", "中"];
  let seed = 42;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let t = 0; t < 200; t++) {
    const len = Math.floor(rand() * 12);
    let s = "";
    for (let i = 0; i < len; i++) s += alphabet[Math.floor(rand() * alphabet.length)];
    checkAgainstNaive(s);
  }
});

test("边界：空串与单字符", () => {
  const { d1, d2 } = manacher([], 0);
  assert.equal(longestPalindromes(d1, d2).length, 0);
  assert.equal(totalPalindromeCount(d1, d2), 0n);
  const one = manacher(["中"], 0);
  assert.equal(longestPalindromes(one.d1, one.d2).length, 1);
  assert.equal(totalPalindromeCount(one.d1, one.d2), 1n);
  assert.deepEqual(longestPalindromes(one.d1, one.d2).intervals, [[0, 1]]);
});

test("整个文档都是回文", () => {
  checkAgainstNaive("abcba");
  const { d1, d2 } = manacher(toCodePoints("🙂🙂🙂🙂"), 0);
  const l = longestPalindromes(d1, d2);
  assert.equal(l.length, 4);
  assert.deepEqual(l.intervals, [[0, 4]]);
});

test("多个并列最长回文", () => {
  const { d1, d2 } = manacher(toCodePoints("abaxcdc"), 0);
  const l = longestPalindromes(d1, d2);
  assert.equal(l.length, 3);
  assert.deepEqual(l.intervals, [[0, 3], [4, 7]]);
});

function tempDb(): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "pal-"));
  return { path: join(dir, "test.db"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("持久化：重建 Store 后旧分析仍可查询", () => {
  const { path, cleanup } = tempDb();
  const s1 = new Store(path);
  const a = s1.buildAnalysis("abacaba");
  s1.close();
  const s2 = new Store(path);
  const r = s2.queryIntervals(a.id, [[0, 7], [0, 2], [3, 3]]);
  assert.deepEqual(r.map(x => x.palindrome), [true, false, true]);
  assert.equal(s2.get(a.id).totalCount, "12");
  s2.close();
  cleanup();
});

test("表情与组合附加符的码点/UTF-16 映射", () => {
  const { path, cleanup } = tempDb();
  const s = new Store(path);
  const a = s.buildAnalysis("x🙂y🙂x e\u0301");
  const byCp = s.extract(a.id, 1, 4, "cp");
  assert.equal(byCp.text, "🙂y🙂");
  assert.deepEqual([byCp.utf16Start, byCp.utf16End], [1, 6]);
  const byU16 = s.extract(a.id, 1, 6, "utf16");
  assert.equal(byU16.text, byCp.text);
  assert.throws(() => s.extract(a.id, 2, 4, "utf16"), (e: ApiError) => e.code === "INVALID_INTERVAL");
  s.close();
  cleanup();
});

test("参数校验与错误码", () => {
  const { path, cleanup } = tempDb();
  const s = new Store(path);
  assert.throws(() => s.buildAnalysis("a\uD800b"), (e: ApiError) => e.code === "LONE_SURROGATE");
  assert.throws(() => s.buildAnalysis(123), (e: ApiError) => e.code === "INVALID_TEXT");
  const a = s.buildAnalysis("abba");
  assert.throws(() => s.queryIntervals(a.id, [[-1, 2]]), (e: ApiError) => e.code === "INTERVAL_OUT_OF_RANGE");
  assert.throws(() => s.queryIntervals(a.id, [[3, 1]]), (e: ApiError) => e.code === "INVALID_INTERVAL");
  assert.throws(() => s.queryIntervals(a.id, [[0.5, 2]]), (e: ApiError) => e.code === "INVALID_INTERVAL");
  assert.throws(() => s.queryIntervals(a.id, [[0, 99]]), (e: ApiError) => e.code === "INTERVAL_OUT_OF_RANGE");
  assert.throws(() => s.get(999), (e: ApiError) => e.code === "NOT_FOUND");
  const ok = s.queryIntervals(a.id, [[2, 2]]);
  assert.equal(ok[0].palindrome, true);
  s.close();
  cleanup();
});

test("解释记录包含镜像与复用信息", () => {
  const { explains } = manacher(toCodePoints("abacaba"), 100);
  const center3 = explains.find(e => e.kind === "odd" && e.center === 3)!;
  assert.ok(center3.newComparisons >= 1);
  const center5 = explains.find(e => e.kind === "odd" && e.center === 5)!;
  assert.equal(center5.mirror, 1);
  assert.equal(center5.initialRadius, 2);
  assert.equal(center5.newComparisons, 0);
});

test("长文本：解释明细截短但计算完整", () => {
  const { path, cleanup } = tempDb();
  const s = new Store(path);
  const n = 20001;
  const a = s.buildAnalysis("a".repeat(n));
  assert.equal(a.explainTruncated, true);
  assert.ok(a.explains.length <= 512);
  assert.equal(a.longestLength, n);
  assert.equal(a.totalCount, String(BigInt(n) * BigInt(n + 1) / 2n));
  s.close();
  cleanup();
});

test("码点到 UTF-16 映射", () => {
  const cps = toCodePoints("a🙂中");
  assert.deepEqual(buildCpToUtf16(cps), [0, 1, 3, 4]);
});
