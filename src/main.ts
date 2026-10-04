import { join } from "node:path";
import { loadConfig } from "./errors.js";
import { Store } from "./db.js";
import { PalService } from "./service.js";
import { createApp, pickFreePort } from "./server.js";
import { runCli } from "./cli.js";

export function bootstrap() {
  const cfg = loadConfig();
  const store = new Store(join(cfg.dataDir, "palindrome.db"));
  const svc = new PalService(store, cfg);
  return { cfg, store, svc };
}

async function main() {
  const args = process.argv.slice(2);
  const { cfg, store, svc } = bootstrap();
  if (args[0] === "serve") {
    const port = cfg.port === 0 ? await pickFreePort() : cfg.port;
    const server = createApp(svc);
    server.listen(port, "127.0.0.1", () => {
      console.log(`回文分析服务已启动: http://127.0.0.1:${port}`);
      console.log(`数据目录: ${cfg.dataDir}`);
    });
  } else {
    if (args.length === 0) args.push("help");
    try {
      await runCli(svc, args);
    } finally {
      store.close();
    }
  }
}

main().catch((e) => {
  const code = (e as { code?: string }).code || "ERR_INTERNAL";
  console.error(`[${code}] ${(e as Error).message}`);
  process.exit(1);
});
