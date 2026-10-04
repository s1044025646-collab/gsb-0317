// 端到端演示：启动服务 → 导入 → 查询 → 重启读取；同时演示 CLI。
// 运行：npm run demo
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDir = mkdtempSync(join(tmpdir(), "pal-demo-"));
const main = "dist/src/main.js";

function run(args, env = {}) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", main, ...args], {
      env: { ...process.env, PAL_DATA_DIR: dataDir, ...env },
      encoding: "utf8",
    });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("close", () => resolve(out.trim()));
  });
}

function cli(args) {
  return run(args);
}

async function serve() {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", main, "serve"], {
      env: { ...process.env, PAL_DATA_DIR: dataDir },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    p.stdout.on("data", (d) => {
      out += d.toString();
      const m = out.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (m) resolve({ proc: p, port: Number(m[1]) });
    });
    p.stderr.on("data", () => {});
    p.on("error", reject);
  });
}

async function api(port, method, path, body) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

console.log("========== CLI 演示 ==========");
for (const text of ["abacaba", "abba", "abcdef", "aaaa"]) {
  console.log(`\n--- 文本 "${text}" ---`);
  console.log(await cli(["import", "--text", text]));
  console.log(await cli(["radius", "--parity", "both"]));
}
console.log("\n--- 区间查询 [0,3) on abacaba（导入回该串）---");
console.log(await cli(["import", "--text", "abacaba"]));
console.log(await cli(["query", "--start", "0", "--end", "3"])); // aba → 是
console.log(await cli(["query", "--start", "0", "--end", "4"])); // abac → 否
console.log(await cli(["fragment", "--start", "2", "--end", "5"])); // aca

console.log("\n========== HTTP API 演示 ==========");
const { proc, port } = await serve();
try {
  const imp = await api(port, "POST", "/api/documents", { text: "😀abba😀" });
  console.log("导入:", imp);
  console.log("最长:", await api(port, "GET", `/api/documents/${imp.docId}/longest`));
  console.log("半径(偶):", await api(port, "GET", `/api/documents/${imp.docId}/radius?parity=even`));
  console.log(
    "批量查询:",
    await api(port, "POST", `/api/documents/${imp.docId}/query`, {
      intervals: [
        { start: 1, end: 5 },
        { start: 0, end: 0 },
        { start: 2, end: 4 },
      ],
    })
  );
  console.log("片段(含UTF16):", await api(port, "POST", `/api/documents/${imp.docId}/fragment`, { start: 0, end: 2 }));
  console.log("错误示例(越界):", await api(port, "POST", `/api/documents/${imp.docId}/query`, { start: 0, end: 99 }));
  console.log("报告:", await api(port, "GET", `/api/documents/${imp.docId}`));
} finally {
  proc.kill();
}

console.log("\n========== 重启持久化演示（CLI） ==========");
console.log(await cli(["longest"])); // 复用 dataDir 中记忆的文档
try {
  rmSync(dataDir, { recursive: true, force: true });
} catch {
  /* Windows 偶发占用可忽略 */
}
