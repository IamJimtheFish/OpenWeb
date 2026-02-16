import express, { type Request, type Response } from "express";
import type { Server } from "node:http";
import { getStore } from "@webx/store";
import { getWebxService } from "./webx-service.js";

const app = express();
const port = Number(process.env.WEBX_API_PORT || 3000);

app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, dbSchemaVersion: getStore().getSchemaVersion() });
});

function bindTool(path: string, handler: (body: unknown) => Promise<unknown>): void {
  app.post(path, async (req: Request, res: Response) => {
    try {
      const data = await handler(req.body);
      res.json(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(400).json({ error: message });
    }
  });
}

const service = getWebxService();

bindTool("/tools/webx.search", (body) => service.search(body));
bindTool("/tools/webx.open", (body) => service.open(body));
bindTool("/tools/webx.actions.list", (body) => service.actionsList(body));
bindTool("/tools/webx.actions.execute", (body) => service.actionsExecute(body));
bindTool("/tools/webx.session.create", (body) => service.sessionCreate(body));
bindTool("/tools/webx.session.save", (body) => service.sessionSave(body));
bindTool("/tools/webx.crawl.start", (body) => service.crawlStart(body));
bindTool("/tools/webx.crawl.status", (body) => service.crawlStatus(body));
bindTool("/tools/webx.crawl.next", (body) => service.crawlNext(body));
bindTool("/tools/webx.store.query", (body) => service.storeQuery(body));

export function startApiServer(): Promise<Server> {
  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      console.log(`[api] listening on :${port}`);
      resolve(server);
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void startApiServer();
}
