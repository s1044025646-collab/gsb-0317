import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { Store } from "./store";
import { ApiError, config, truncate } from "./config";
import { toCodePoints } from "./config";

const store = new Store();

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(payload);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function route(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const m = url.pathname.match(/^\/documents(?:\/(\d+))?(?:\/(radii|query|longest|extract|report|explain))?$/);
  if (req.method === "POST" && url.pathname === "/documents") {
    const body = JSON.parse(await readBody(req) || "{}");
    const a = store.buildAnalysis(body.text);
    sendJson(res, 201, { id: a.id, cpCount: a.cpCount, longestLength: a.longestLength, totalCount: a.totalCount });
    return;
  }
  if (!m || !m[1]) {
    if (req.method === "GET" && url.pathname === "/documents") { sendJson(res, 200, store.list()); return; }
    throw new ApiError("NOT_FOUND", "路由不存在", 404);
  }
  const id = Number(m[1]);
  const sub = m[2];
  if (req.method === "GET" && sub === "radii") {
    const a = store.get(id);
    const center = url.searchParams.has("center") ? Number(url.searchParams.get("center")) : 0;
    const count = url.searchParams.has("count") ? Number(url.searchParams.get("count")) : 50;
    if (!Number.isInteger(center) || !Number.isInteger(count) || center < 0 || count < 1 || count > 1000 || center >= Math.max(a.cpCount, 1)) {
      throw new ApiError("INVALID_INTERVAL", "center/count 参数非法");
    }
    sendJson(res, 200, {
      center, count,
      d1: a.d1.slice(center, center + count),
      d2: a.d2.slice(center, center + count),
      explains: a.explains.filter(e => e.center >= center && e.center < center + count),
      explainTruncated: a.explainTruncated,
    });
    return;
  }
  if (req.method === "POST" && sub === "query") {
    const body = JSON.parse(await readBody(req) || "{}");
    sendJson(res, 200, { results: store.queryIntervals(id, body.intervals) });
    return;
  }
  if (req.method === "GET" && sub === "longest") {
    const a = store.get(id);
    const cps = toCodePoints(a.text);
    const intervals = a.longestIntervals.map(([s, e]) => ({
      start: s, end: e,
      utf16Start: a.cpToUtf16[s], utf16End: a.cpToUtf16[e],
      snippet: truncate(cps.slice(s, e).join(""), config.maxSnippet),
    }));
    sendJson(res, 200, { length: a.longestLength, count: a.longestIntervals.length, intervals, totalCount: a.totalCount });
    return;
  }
  if (req.method === "GET" && sub === "extract") {
    const start = Number(url.searchParams.get("start"));
    const end = Number(url.searchParams.get("end"));
    const offset = (url.searchParams.get("offset") ?? "cp") as "cp" | "utf16";
    if (offset !== "cp" && offset !== "utf16") throw new ApiError("INVALID_INTERVAL", "offset 必须是 cp 或 utf16");
    sendJson(res, 200, store.extract(id, start, end, offset));
    return;
  }
  if (req.method === "GET" && sub === "report") { sendJson(res, 200, store.report(id)); return; }
  if (req.method === "GET" && sub === "explain") {
    const a = store.get(id);
    sendJson(res, 200, { explains: a.explains, truncated: a.explainTruncated });
    return;
  }
  throw new ApiError("NOT_FOUND", "路由不存在", 404);
}

const server = createServer((req, res) => {
  route(req, res, new URL(req.url ?? "/", "http://localhost")).catch((err) => {
    if (err instanceof ApiError) sendJson(res, err.status, { error: { code: err.code, message: err.message } });
    else if (err instanceof SyntaxError) sendJson(res, 400, { error: { code: "INVALID_JSON", message: "请求体不是合法 JSON" } });
    else sendJson(res, 500, { error: { code: "INTERNAL", message: String(err) } });
  });
});

server.listen(config.port, () => {
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : config.port;
  console.log(`回文分析服务已启动: http://127.0.0.1:${port} (数据库: ${config.dbPath})`);
});
