import { readFileSync } from "node:fs";
import { Store } from "./store";
import { toCodePoints, truncate } from "./config";

const store = new Store();

function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) => Math.max(displayWidth(h), ...rows.map(r => displayWidth(r[i] ?? ""))));
  const line = (cells: string[]) => cells.map((c, i) => c + " ".repeat(widths[i] - displayWidth(c))).join("  ");
  return [line(headers), line(widths.map(w => "-".repeat(w))), ...rows.map(line)].join("\n");
}

function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += (ch.codePointAt(0)! > 0xff) ? 2 : 1;
  return w;
}

function fail(msg: string): never {
  console.error(`错误: ${msg}`);
  process.exit(1);
}

function radiiTable(id: number, center: number, count: number): string {
  const a = store.get(id);
  const cps = toCodePoints(a.text);
  const rows: string[][] = [];
  for (let i = center; i < Math.min(center + count, a.cpCount); i++) {
    const ex = a.explains.filter(e => e.center === i);
    const odd = ex.find(e => e.kind === "odd");
    const even = ex.find(e => e.kind === "even");
    rows.push([
      String(i), cps[i], String(a.d1[i]), String(a.d2[i]),
      odd ? `${odd.mirror ?? "-"}/${odd.initialRadius}/${odd.newComparisons}` : "-",
      even ? `${even.mirror ?? "-"}/${even.initialRadius}/${even.newComparisons}` : "-",
    ]);
  }
  return table(["中心", "字符", "奇半径", "偶半径", "奇(镜像/复用/新增)", "偶(镜像/复用/新增)"], rows);
}

function longestOut(id: number): string {
  const a = store.get(id);
  const cps = toCodePoints(a.text);
  const rows = a.longestIntervals.map(([s, e]) => [
    String(s), String(e), String(a.cpToUtf16[s]), String(a.cpToUtf16[e]),
    truncate(cps.slice(s, e).join(""), 40).text,
  ]);
  return `最长长度: ${a.longestLength}  并列区间数: ${a.longestIntervals.length}  非空回文总数: ${a.totalCount}\n` +
    table(["起点(cp)", "终点(cp)", "起点(u16)", "终点(u16)", "片段"], rows);
}

const [, , cmd, ...args] = process.argv;

try {
  switch (cmd) {
    case "import": {
      const source = args[0] ?? fail("用法: cli import <文件路径|-t 文本>");
      const text = source === "-t" ? args.slice(1).join(" ") : readFileSync(source, "utf8");
      const a = store.buildAnalysis(text);
      console.log(`已导入并分析，ID=${a.id}，码点数=${a.cpCount}，最长=${a.longestLength}，总数=${a.totalCount}`);
      break;
    }
    case "list": {
      const rows = store.list().map(r => [String(r.id), r.createdAt, String(r.cpCount), String(r.longestLength), r.totalCount, r.preview]);
      console.log(table(["ID", "创建时间", "码点数", "最长", "总数", "预览"], rows));
      break;
    }
    case "radii": {
      const id = Number(args[0]) || fail("用法: cli radii <id> [center] [count]");
      console.log(radiiTable(id, Number(args[1] ?? 0), Number(args[2] ?? 50)));
      break;
    }
    case "query": {
      const id = Number(args[0]) || fail("用法: cli query <id> <start> <end>");
      const [s, e] = [Number(args[1]), Number(args[2])];
      const r = store.queryIntervals(id, [[s, e]]);
      console.log(`[${r[0].start}, ${r[0].end}) 是否回文: ${r[0].palindrome ? "是" : "否"}`);
      break;
    }
    case "longest": {
      const id = Number(args[0]) || fail("用法: cli longest <id>");
      console.log(longestOut(id));
      break;
    }
    case "extract": {
      const id = Number(args[0]) || fail("用法: cli extract <id> <start> <end> [--utf16]");
      const offset = args.includes("--utf16") ? "utf16" : "cp";
      const nums = args.filter(x => !x.startsWith("--")).slice(1).map(Number);
      const r = store.extract(id, nums[0], nums[1], offset);
      console.log(`cp[${r.cpStart}, ${r.cpEnd}) = utf16[${r.utf16Start}, ${r.utf16End}) -> ${JSON.stringify(r.text)}`);
      break;
    }
    case "report": {
      const id = Number(args[0]) || fail("用法: cli report <id>");
      console.log(JSON.stringify(store.report(id), null, 2));
      break;
    }
    case "demo": {
      const samples = ["abacaba", "abba", "abcdef", "aaaaa", "abba🙂🙂abba", "上海自来水来自海上"];
      for (const s of samples) {
        const a = store.buildAnalysis(s);
        console.log(`\n=== ${JSON.stringify(s)} (ID=${a.id}) ===`);
        console.log(radiiTable(a.id, 0, a.cpCount));
        console.log(longestOut(a.id));
      }
      const emoji = store.buildAnalysis("x🙂y🙂x");
      const byCp = store.extract(emoji.id, 1, 4, "cp");
      const byU16 = store.extract(emoji.id, byCp.utf16Start, byCp.utf16End, "utf16");
      console.log(`\n=== 表情偏移映射 (ID=${emoji.id}) ===`);
      console.log(`码点区间 [1,4): ${JSON.stringify(byCp.text)}; UTF-16 区间 [${byU16.utf16Start},${byU16.utf16End}): ${JSON.stringify(byU16.text)}; 一致: ${byCp.text === byU16.text}`);
      break;
    }
    default:
      console.log(`用法: node dist/src/cli.js <命令>
  import <文件|-t 文本>   导入文本并构建分析
  list                   列出全部分析版本
  radii <id> [c] [n]     查看中心半径表（含镜像/复用/新增比较）
  query <id> <s> <e>     查询区间 [s,e) 是否回文
  longest <id>           查看最长回文与全部并列区间
  extract <id> <s> <e> [--utf16]  按码点或 UTF-16 偏移提取原文
  report <id>            导出 JSON 报告
  demo                   运行内置演示样例`);
  }
} catch (err: any) {
  fail(`${err.code ?? "ERROR"}: ${err.message}`);
} finally {
  store.close();
}
