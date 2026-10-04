import { readFileSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { PalService } from "./service.js";
import type { VersionRow } from "./db.js";
import { ApiError } from "./errors.js";

// CLI 记忆“当前文档/版本”，重启后仍可继续查询。
const STATE_FILE = "cli-state.json";

interface CliState {
  docId?: number;
}

function loadState(dataDir: string): CliState {
  try {
    return JSON.parse(readFileSync(join(dataDir, STATE_FILE), "utf8")) as CliState;
  } catch {
    return {};
  }
}

function saveState(dataDir: string, st: CliState) {
  try {
    writeFileSync(join(dataDir, STATE_FILE), JSON.stringify(st));
  } catch {
    /* 状态保存失败不影响主流程 */
  }
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function printRadiusTable(v: VersionRow, parity: "odd" | "even") {
  const arr = parity === "odd" ? v.odd : v.even;
  console.log(parity === "odd" ? "奇数半径（中心=字符，半径含中心）" : "偶数半径（中心=间隙 i，位于 i-1 与 i 之间）");
  console.log(pad("center", 8) + pad("radius", 8) + "区间[start,end)");
  for (let i = 0; i < arr.length; i++) {
    const rad = arr[i]!;
    let interval = "-";
    if (parity === "odd") {
      if (rad >= 1) interval = `[${i - rad + 1}, ${i + rad})`;
    } else if (rad >= 1) {
      interval = `[${i - rad}, ${i + rad})`;
    }
    console.log(pad(String(i), 8) + pad(String(rad), 8) + interval);
  }
}

export async function runCli(svc: PalService, args: string[]): Promise<void> {
  const cmd = args[0];
  const state = loadState(svc.cfg.dataDir);

  const resolveDoc = (idFlag?: string): number => {
    const id = idFlag !== undefined ? Number(idFlag) : state.docId;
    if (id === undefined || !Number.isInteger(id)) {
      throw new ApiError("ERR_BAD_REQUEST", "请先用 --doc 指定文档，或先导入文本");
    }
    return id;
  };

  const flag = (name: string): string | undefined => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };

  switch (cmd) {
    case "import": {
      let text: string;
      const file = flag("--file");
      if (file !== undefined) {
        text = readFileSync(file, "utf8");
      } else {
        text = args.slice(1).filter((a) => !a.startsWith("--")).join(" ");
        const t = flag("--text");
        if (t !== undefined) text = t;
      }
      const existing = flag("--doc");
      const v = svc.importText(existing !== undefined ? Number(existing) : null, text);
      state.docId = v.docId;
      saveState(svc.cfg.dataDir, state);
      console.log(`已保存 文档=${v.docId} 版本=${v.version} 版本ID=${v.id} 码点长度=${v.length}`);
      console.log(`最长长度=${v.longestLength} 回文总数=${v.total} 并列最长区间数=${v.longest.length}`);
      return;
    }
    case "analyze":
    case "longest": {
      const docId = resolveDoc(flag("--doc"));
      const v = svc.resolveVersion(docId, flag("--version") !== undefined ? Number(flag("--version")) : undefined);
      console.log(`文档=${v.docId} 版本=${v.version} 长度=${v.length} 算法=${v.algoVersion}`);
      console.log(`最长回文长度=${v.longestLength} 非空回文出现总数=${v.total}`);
      console.log("最长区间（左闭右开，按起点排序）:");
      for (const it of v.longest) console.log(`  [${it.start}, ${it.end})`);
      return;
    }
    case "radius": {
      const docId = resolveDoc(flag("--doc"));
      const v = svc.resolveVersion(docId, flag("--version") !== undefined ? Number(flag("--version")) : undefined);
      const parity = (flag("--parity") ?? "both") as "odd" | "even" | "both";
      if (parity === "even") printRadiusTable(v, "even");
      else if (parity === "odd") printRadiusTable(v, "odd");
      else {
        printRadiusTable(v, "odd");
        console.log("");
        printRadiusTable(v, "even");
      }
      return;
    }
    case "query": {
      const docId = resolveDoc(flag("--doc"));
      const v = svc.resolveVersion(docId, flag("--version") !== undefined ? Number(flag("--version")) : undefined);
      const start = Number(flag("--start"));
      const end = Number(flag("--end"));
      const r = svc.checkInterval(v, start, end);
      console.log(`区间 [${r.start}, ${r.end}) 长度=${r.length} 回文=${r.palindrome ? "是" : "否"}`);
      return;
    }
    case "fragment": {
      const docId = resolveDoc(flag("--doc"));
      const v = svc.resolveVersion(docId, flag("--version") !== undefined ? Number(flag("--version")) : undefined);
      const r = svc.fragment(v, Number(flag("--start")), Number(flag("--end")));
      console.log(`码点 [${r.start}, ${r.end}) UTF-16 [${r.utf16.start}, ${r.utf16.end})`);
      console.log(`原文: ${JSON.stringify(r.text)}${r.truncated ? "  (片段已截断)" : ""}`);
      return;
    }
    case "explain": {
      const docId = resolveDoc(flag("--doc"));
      const v = svc.resolveVersion(docId, flag("--version") !== undefined ? Number(flag("--version")) : undefined);
      console.log(pad("parity", 7) + pad("center", 7) + pad("mirror", 7) + pad("initR", 6) + pad("newCmp", 7) + pad("matched", 8) + "radius");
      for (const e of v.explain) {
        console.log(
          pad(e.parity, 7) +
            pad(String(e.center), 7) +
            pad(String(e.mirror), 7) +
            pad(String(e.initialRadius), 6) +
            pad(String(e.newComparisons), 7) +
            pad(String(e.matched), 8) +
            e.radius
        );
      }
      if (v.explainTruncated) console.log(`（解释明细已截断，仅保留前 ${v.explain.length} 条）`);
      return;
    }
    case "versions": {
      const docId = resolveDoc(flag("--doc"));
      for (const ver of svc.store.listVersions(docId)) {
        console.log(`版本ID=${ver.versionId} 序号=${ver.version} 长度=${ver.length} 创建=${ver.createdAt}`);
      }
      return;
    }
    case "report": {
      const docId = resolveDoc(flag("--doc"));
      const v = svc.resolveVersion(docId, flag("--version") !== undefined ? Number(flag("--version")) : undefined);
      console.log(JSON.stringify(svc.report(v), null, 2));
      return;
    }
    case "serve": {
      throw new ApiError("ERR_BAD_REQUEST", "serve 由启动入口处理");
    }
    default:
      printHelp();
  }
}

function printHelp() {
  console.log(`用法: pal <命令> [参数]

命令:
  import --text "<文本>" | --file <路径> [--doc <id>]   导入文本并构建分析（新版本）
  analyze  [--doc <id>] [--version <版本ID>]           查看最长回文与总数
  longest  （同 analyze）
  radius   --parity odd|even|both [--doc] [--version]  查看中心半径小表格
  query    --start <s> --end <e> [--doc] [--version]   判断区间是否回文（基于半径）
  fragment --start <s> --end <e> [--doc] [--version]   提取原文，附 UTF-16 偏移
  explain  [--doc] [--version]                         镜像复用解释明细
  versions [--doc]                                     列出文档全部版本
  report   [--doc] [--version]                         导出 JSON 报告

服务: pal serve  （默认端口 0=自动选择空闲端口，可用 PORT 指定）`);
}
