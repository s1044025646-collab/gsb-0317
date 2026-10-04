import { createServer, type IncomingMessage, type Server } from "node:http";
import { createServer as netCreateServer } from "node:net";
import { PalService } from "./service.js";
import { ApiError } from "./errors.js";

interface Route {
  method: string;
  pattern: RegExp;
  handle: (svc: PalService, m: RegExpMatchArray, body: unknown, q: URLSearchParams) => unknown;
}

const routes: Route[] = [
  {
    method: "POST",
    pattern: /^\/api\/documents$/,
    handle: (svc, _m, body) => {
      const text = (body as { text?: unknown })?.text;
      const v = svc.importText(null, text);
      return { docId: v.docId, versionId: v.id, version: v.version, length: v.length };
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/documents\/(\d+)$/,
    handle: (svc, m, body) => {
      const v = svc.importText(Number(m[1]), (body as { text?: unknown })?.text);
      return { docId: v.docId, versionId: v.id, version: v.version, length: v.length };
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/documents\/(\d+)$/,
    handle: (svc, m, _b, q) => {
      const v = svc.resolveVersion(Number(m[1]), q.has("version") ? Number(q.get("version")) : undefined);
      return svc.report(v);
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/documents\/(\d+)\/versions$/,
    handle: (svc, m) => svc.store.listVersions(Number(m[1])),
  },
  {
    method: "GET",
    pattern: /^\/api\/documents\/(\d+)\/radius$/,
    handle: (svc, m, _b, q) => {
      const v = svc.resolveVersion(Number(m[1]), q.has("version") ? Number(q.get("version")) : undefined);
      return svc.radiusView(v, q.get("parity") ?? "odd", q.get("offset"), q.get("limit"));
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/documents\/(\d+)\/longest$/,
    handle: (svc, m, _b, q) => {
      const v = svc.resolveVersion(Number(m[1]), q.has("version") ? Number(q.get("version")) : undefined);
      return {
        longestLength: v.longestLength,
        longest: v.longest,
        totalPalindromes: v.total,
      };
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/documents\/(\d+)\/query$/,
    handle: (svc, m, body, q) => {
      const v = svc.resolveVersion(Number(m[1]), q.has("version") ? Number(q.get("version")) : undefined);
      const b = body as { start?: unknown; end?: unknown; intervals?: unknown };
      if (Array.isArray(b?.intervals)) return { results: svc.queryBatch(v, b.intervals) };
      return svc.checkInterval(v, b?.start, b?.end);
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/documents\/(\d+)\/fragment$/,
    handle: (svc, m, body, q) => {
      const v = svc.resolveVersion(Number(m[1]), q.has("version") ? Number(q.get("version")) : undefined);
      const b = body as { start?: unknown; end?: unknown };
      return svc.fragment(v, b?.start, b?.end);
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/documents\/(\d+)\/explain$/,
    handle: (svc, m, _b, q) => {
      const v = svc.resolveVersion(Number(m[1]), q.has("version") ? Number(q.get("version")) : undefined);
      return {
        explain: v.explain,
        truncated: v.explainTruncated,
        algoVersion: v.algoVersion,
      };
    },
  },
];

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > 5_000_000) {
        reject(new ApiError("ERR_BAD_REQUEST", "请求体过大", 413));
        req.destroy();
        return;
      }
      data += c.toString("utf8");
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new ApiError("ERR_BAD_REQUEST", "请求体不是合法 JSON"));
      }
    });
    req.on("error", reject);
  });
}

export function createApp(svc: PalService): Server {
  return createServer(async (req, res) => {
    const send = (status: number, payload: unknown) => {
      const json = JSON.stringify(payload);
      res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
      res.end(json);
    };
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (req.method === "GET" && url.pathname === "/health") {
        return send(200, { ok: true });
      }
      let body: unknown = {};
      if (req.method === "POST") body = await readBody(req);
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = url.pathname.match(r.pattern);
        if (m) return send(200, r.handle(svc, m, body, url.searchParams));
      }
      send(404, { error: { code: "ERR_NOT_FOUND", message: "接口不存在" } });
    } catch (e) {
      if (e instanceof ApiError) {
        send(e.status, { error: { code: e.code, message: e.message } });
      } else {
        send(500, {
          error: { code: "ERR_INTERNAL", message: (e as Error).message },
        });
      }
    }
  });
}

/** 选择空闲端口。 */
export function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = netCreateServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else reject(new Error("无法获取空闲端口"));
    });
    srv.on("error", reject);
  });
}
