import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/db.js";
import { PalService } from "../src/service.js";
import { loadConfig, ApiError } from "../src/errors.js";
import { decodeText, sliceByPoints } from "../src/unicode.js";
import { isPalindromeInterval, runManacher } from "../src/manacher.js";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "pal-"));
  const cfg = loadConfig();
  cfg.dataDir = dir;
  const store = new Store(join(dir, "test.db"));
  const svc = new PalService(store, cfg);
  return { dir, store, svc, cfg };
}

function naive(text: string) {
  const { points } = decodeText(text);
  const n = points.length;
  let total = 0n;
  let best = 0;
  const intervals: Array<[number, number]> = [];
  const isPal = (a: number, b: number) => {
    let i = a;
    let j = b - 1;
    while (i < j) {
      if (points[i] !== points[j]) return false;
      i++;
      j--;
    }
    return true;
  };
  for (let s = 0; s < n; s++) {
    for (let e = s + 1; e <= n; e++) {
      if (isPal(s, e)) {
        total++;
        const len = e - s;
        if (len > best) {
          best = len;
          intervals.length = 0;
        }
        if (len === best) intervals.push([s, e]);
      }
    }
  }
  intervals.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return { total: total.toString(), best, intervals };
}

const samples = ["", "a", "abacaba", "abba", "abcdef", "aaaa", "ababa", "aabxaa", "中文回文文中", "😀abba😀", "éé", "a🙂🙂a"];

test("朴素枚举核对：最长位置、总数、全部区间查询", () => {
  const { store, svc } = setup();
  for (const text of samples) {
    const v = svc.importText(null, text);
    const exp = naive(text);
    assert.equal(v.total, exp.total, `总数不符: ${text}`);
    assert.equal(v.longestLength, exp.best, `最长长度不符: ${text}`);
    assert.deepEqual(
      v.longest.map((i) => [i.start, i.end]),
      exp.intervals,
      `最长区间不符: ${text}`
    );
    // 枚举所有区间，核对查询结果
    const n = v.length;
    for (let s = 0; s <= n; s++) {
      for (let e = s; e <= n; e++) {
        const r = svc.checkInterval(v, s, e);
        const points = v.decoded.points;
        let i = s;
        let j = e - 1;
        let expect = true;
        while (i < j) {
          if (points[i] !== points[j]) {
            expect = false;
            break;
          }
          i++;
          j--;
        }
        assert.equal(r.palindrome, expect, `区间查询不符: "${text}" [${s},${e})`);
      }
    }
  }
  store.close();
});

test("半径边界：内部对称成立，向外一步越界或不相等", () => {
  for (const text of ["abacaba", "abba", "aaaa", "abcdef", "xabaxxabba"]) {
    const { points } = decodeText(text);
    const { odd, even } = runManacher(points);
    const n = points.length;
    for (let c = 0; c < n; c++) {
      const r = odd[c]!;
      // 内部全部对称
      for (let k = 0; k < r; k++) {
        assert.equal(points[c - k], points[c + k], `odd 内部 ${text} c=${c} k=${k}`);
      }
      // 再向外一步
      const nl = c - r;
      const nr = c + r;
      assert.ok(nl < 0 || nr >= n || points[nl] !== points[nr], `odd 应已极大 ${text} c=${c}`);
    }
    for (let c = 0; c < n; c++) {
      const r = even[c]!;
      for (let k = 1; k <= r; k++) {
        assert.equal(points[c - k], points[c + k - 1], `even 内部 ${text} c=${c} k=${k}`);
      }
      const nl = c - r - 1;
      const nr = c + r;
      assert.ok(nl < 0 || nr >= n || points[nl] !== points[nr], `even 应已极大 ${text} c=${c}`);
    }
  }
});

test("奇数与偶数半径差异：abacaba / abba / 无重复 / 全相同", () => {
  const aba = runManacher(decodeText("abacaba").points);
  assert.equal(aba.odd[3], 4); // 中心 c，半径4，长度7
  assert.equal(aba.longestLength, 7);
  assert.ok(aba.even.every((x) => x === 0));

  const abba = runManacher(decodeText("abba").points);
  assert.equal(abba.even[2], 2); // 间隙 2，半径2，整串
  assert.deepEqual(Array.from(abba.odd), [1, 1, 1, 1]);
  assert.equal(abba.longestLength, 4);

  const noDup = runManacher(decodeText("abcdef").points);
  assert.ok(noDup.odd.every((x) => x === 1));
  assert.ok(noDup.even.every((x) => x === 0));
  assert.equal(noDup.total, "6");

  const all = runManacher(decodeText("aaaa").points);
  assert.deepEqual(Array.from(all.odd), [1, 2, 2, 1]);
  assert.deepEqual(Array.from(all.even), [0, 1, 2, 1]);
  assert.equal(all.total, "10"); // 奇6 + 偶4
});

test("特殊情况：空串、单字符、表情、组合附加符、中文、并列最长、整篇回文", () => {
  const { store, svc } = setup();
  const empty = svc.importText(null, "");
  assert.equal(empty.longestLength, 0);
  assert.equal(empty.total, "0");
  assert.deepEqual(empty.longest, []);
  assert.equal(svc.checkInterval(empty, 0, 0).palindrome, true);

  const one = svc.importText(null, "x");
  assert.equal(one.longestLength, 1);
  assert.equal(one.total, "1");

  // 表情为单码点（UTF-16 占 2），回文按码点
  const emoji = svc.importText(null, "😀a😀");
  assert.equal(emoji.longestLength, 3);
  const f = svc.fragment(emoji, 0, 1);
  assert.equal(f.text, "😀");
  assert.deepEqual(f.utf16, { start: 0, end: 2 });

  // 组合附加符不归一化：e + 组合重音 是两个码点
  const comb = "e\u0301";
  const cv = svc.importText(null, comb + comb);
  assert.equal(cv.length, 4);
  // 序列 e,´,e,´：长度 3 的 e,´,e 与 ´,e,´ 是回文；整体不是，因为未归一化
  assert.equal(cv.longestLength, 3);
  assert.equal(cv.longest.length, 2);

  // 中文
  const zh = svc.importText(null, "上海自来水来自海上");
  assert.equal(zh.longestLength, 9);

  // 多个并列最长
  const tiedText = "aaaxayaa"; // 存在多个并列的长度 3 最长回文（aaa / axa / aya）
  const tied = svc.importText(null, tiedText);
  const expTied = naive(tiedText);
  assert.deepEqual(
    tied.longest.map((i) => [i.start, i.end]),
    expTied.intervals
  );
  assert.ok(tied.longest.length >= 2);

  // 整篇就是回文
  assert.equal(emoji.longest[0]!.start, 0);
  assert.equal(emoji.longest[0]!.end, 3);
  store.close();
});

test("码点与 UTF-16 两种偏移取回相同原文", () => {
  const { store, svc } = setup();
  const text = "a😀中b🙂";
  const v = svc.importText(null, text);
  // 用码点区间取回
  const byPoints = sliceByPoints(v.decoded, 1, 4); // 😀中b
  assert.equal(byPoints, "😀中b");
  // 用映射得到 UTF-16 区间，直接在原串上切片应一致
  const u0 = v.decoded.map[1]!;
  const u1 = v.decoded.map[4]!;
  assert.equal(text.slice(u0, u1), byPoints);
  // 全文
  assert.equal(sliceByPoints(v.decoded, 0, v.length), text);
  assert.equal(text.slice(v.decoded.map[0]!, v.raw.length), text);
  store.close();
});

test("重启后旧分析仍可读取，改动文本产生新版本", () => {
  const { dir, cfg } = setup();
  let store = new Store(join(dir, "t.db"));
  let svc = new PalService(store, cfg);
  const v1 = svc.importText(null, "abba");
  const v2 = svc.importText(v1.docId, "abcba");
  assert.equal(v2.version, 2);
  store.close();

  // 重新打开（模拟进程重启）
  store = new Store(join(dir, "t.db"));
  svc = new PalService(store, cfg);
  const old = svc.resolveVersion(v1.docId, v1.id);
  assert.equal(old.raw, "abba");
  assert.equal(old.longestLength, 4);
  const cur = svc.resolveVersion(v1.docId);
  assert.equal(cur.raw, "abcba");
  assert.equal(cur.longestLength, 5);
  const versions = svc.store.listVersions(v1.docId);
  assert.equal(versions.length, 2);
  store.close();
  rmRetry(dir);
});

function rmRetry(dir: string) {
  for (let i = 0; i < 5; i++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
      sleep(100);
      try {
        execSync(`cmd /c rmdir /s /q "${dir}"`);
        return;
      } catch {
        /* 再试 */
      }
    }
  }
}

test("参数校验与错误码", () => {
  const { store, svc } = setup();
  const v = svc.importText(null, "abba");
  assert.throws(() => svc.checkInterval(v, 0, 5), ApiError);
  assert.throws(() => svc.checkInterval(v, -1, 2), (e: Error) => e.message.includes("越界"));
  assert.throws(() => svc.checkInterval(v, 3, 2), (e: ApiError) => e.code === "ERR_START_GT_END");
  assert.throws(() => svc.checkInterval(v, 1.5, 2), (e: ApiError) => e.code === "ERR_BAD_INDEX");
  assert.throws(() => svc.checkInterval(v, "x" as unknown, 2), (e: ApiError) => e.code === "ERR_BAD_INDEX");
  // 孤立代理项
  assert.throws(
    () => svc.importText(null, "ab\uD800cd"),
    (e: ApiError) => e.code === "ERR_LONE_SURROGATE"
  );
  // 空区间合法且不纳入总数（总数仅 4）
  assert.equal(svc.checkInterval(v, 1, 1).palindrome, true);
  store.close();
});

test("解释明细记录镜像复用信息", () => {
  const { points } = decodeText("abacaba");
  const r = runManacher(points, { explainCap: 200 });
  assert.equal(r.explainTruncated, false);
  assert.equal(r.explain.length, 14); // 7 奇 + 7 偶
  const centerC = r.explain.find((e) => e.parity === "odd" && e.center === 3)!;
  assert.ok(centerC);
  assert.equal(centerC.radius, 4);
});

test("长文本：解释截断但位置与总数仍完整", () => {
  const { store, svc } = setup();
  const text = "ab".repeat(300); // 600 码点
  const v = svc.importText(null, text);
  const exp = naive(text);
  assert.equal(v.total, exp.total);
  assert.equal(v.longestLength, exp.best);
  assert.equal(v.explain.length, svc.cfg.explainCap);
  assert.equal(v.explainTruncated, true);
  // 半径数组完整
  assert.equal(v.odd.length, 600);
  assert.equal(v.even.length, 600);
  store.close();
});
