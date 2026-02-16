import { getWebxService } from "@webx/api";

async function main(): Promise<void> {
  const [, , tool, payload] = process.argv;
  if (!tool) {
    console.error("Usage: webx-cli <tool> '<jsonPayload>'");
    process.exit(1);
  }

  const service = getWebxService();
  const body = payload ? (JSON.parse(payload) as unknown) : {};

  let result: unknown;
  switch (tool) {
    case "webx.search":
      result = await service.search(body);
      break;
    case "webx.open":
      result = await service.open(body);
      break;
    case "webx.actions.list":
      result = await service.actionsList(body);
      break;
    case "webx.actions.execute":
      result = await service.actionsExecute(body);
      break;
    case "webx.session.create":
      result = await service.sessionCreate(body);
      break;
    case "webx.session.save":
      result = await service.sessionSave(body);
      break;
    case "webx.crawl.start":
      result = await service.crawlStart(body);
      break;
    case "webx.crawl.status":
      result = await service.crawlStatus(body);
      break;
    case "webx.crawl.next":
      result = await service.crawlNext(body);
      break;
    case "webx.store.query":
      result = await service.storeQuery(body);
      break;
    default:
      throw new Error(`Unknown tool: ${tool}`);
  }

  console.log(JSON.stringify(result, null, 2));
}

void main();
