import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getWebxService } from "@webx/api";

type ZodShape = Record<string, z.ZodTypeAny>;

function asToolResponse(payload: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(payload)
      }
    ]
  };
}

export async function startMcpServer(): Promise<void> {
  const server = new McpServer({
    name: "webx",
    version: "0.1.0"
  });

  const service = getWebxService();

  const registerTool = (
    name: string,
    description: string,
    schema: ZodShape,
    handler: (args: Record<string, unknown>) => Promise<unknown>
  ) => {
    (server.tool as any)(name, description, schema, async (args: Record<string, unknown>) =>
      asToolResponse(await handler(args))
    );
  };

  registerTool(
    "webx.search",
    "Search web results via SearXNG",
    {
      query: z.string(),
      options: z
        .object({
          limit: z.number().int().min(1).max(20).optional(),
          engines: z.array(z.string()).optional(),
          categories: z.array(z.string()).optional(),
          language: z.string().optional()
        })
        .optional()
    },
    (args) => service.search(args)
  );

  registerTool(
    "webx.open",
    "Open and extract a page",
    {
      url: z.string().url(),
      mode: z.enum(["compact", "full"]).optional(),
      use: z.enum(["auto", "static", "playwright"]).optional(),
      session: z.string().optional()
    },
    (args) => service.open(args)
  );

  registerTool(
    "webx.actions.list",
    "List actions available on a page",
    {
      url: z.string().url().optional(),
      pageId: z.string().optional(),
      session: z.string().optional()
    },
    (args) => service.actionsList(args)
  );

  registerTool(
    "webx.actions.execute",
    "Execute a previously listed action",
    {
      actionId: z.string(),
      params: z.record(z.any()).optional(),
      session: z.string(),
      returnPage: z.boolean().optional(),
      mode: z.enum(["compact", "full"]).optional()
    },
    (args) => service.actionsExecute(args)
  );

  registerTool(
    "webx.session.create",
    "Create a browser session",
    {
      name: z.string(),
      headed: z.boolean().optional()
    },
    (args) => service.sessionCreate(args)
  );

  registerTool(
    "webx.session.save",
    "Persist a browser session",
    {
      name: z.string()
    },
    (args) => service.sessionSave(args)
  );

  registerTool(
    "webx.crawl.start",
    "Start a crawl job",
    {
      seedUrls: z.array(z.string().url()),
      options: z
        .object({
          maxPages: z.number().int().optional(),
          maxDepth: z.number().int().optional(),
          mode: z.enum(["compact", "full"]).optional(),
          allowDomains: z.array(z.string()).optional(),
          denyDomains: z.array(z.string()).optional(),
          respectRobots: z.boolean().optional(),
          perDomainDelayMs: z.number().int().optional()
        })
        .optional()
    },
    (args) => service.crawlStart(args)
  );

  registerTool(
    "webx.crawl.status",
    "Get crawl job status",
    {
      jobId: z.string()
    },
    (args) => service.crawlStatus(args)
  );

  registerTool(
    "webx.crawl.next",
    "Get crawled pages from a job",
    {
      jobId: z.string(),
      limit: z.number().int().optional(),
      mode: z.enum(["compact", "full"]).optional()
    },
    (args) => service.crawlNext(args)
  );

  registerTool(
    "webx.store.query",
    "Query stored pages",
    {
      text: z.string(),
      limit: z.number().int().optional()
    },
    (args) => service.storeQuery(args)
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void startMcpServer();
}
