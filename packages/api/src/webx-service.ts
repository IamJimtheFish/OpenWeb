import {
  ActionsExecuteInputSchema,
  ActionsExecuteOutputSchema,
  ActionsListInputSchema,
  ActionsListOutputSchema,
  CrawlNextInputSchema,
  CrawlNextOutputSchema,
  CrawlStartInputSchema,
  CrawlStartOutputSchema,
  CrawlStatusInputSchema,
  CrawlStatusOutputSchema,
  OpenInputSchema,
  OpenOutputSchema,
  SearchInputSchema,
  SearchOutputSchema,
  SessionCreateInputSchema,
  SessionOutputSchema,
  SessionSaveInputSchema,
  StoreQueryInputSchema,
  StoreQueryOutputSchema
} from "@webx/types";
import { openStatic } from "@webx/core";
import { getSearxngClient } from "@webx/searxng";
import { getStore } from "@webx/store";
import { getBrowserManager } from "@webx/browser";
import { getCrawlerService } from "@webx/crawler";

function markSuccess(tool: "search" | "open" | "action" | "crawl"): void {
  getStore().setMeta(`last_success_${tool}`, new Date().toISOString());
}

export class WebxService {
  async search(input: unknown) {
    const parsed = SearchInputSchema.parse(input);
    const results = await getSearxngClient().search(parsed.query, parsed.options);
    const output = SearchOutputSchema.parse({ results });
    markSuccess("search");
    return output;
  }

  async open(input: unknown) {
    const parsed = OpenInputSchema.parse(input);
    const mode = parsed.mode ?? "compact";
    const use = parsed.use ?? "auto";

    let page;

    if (use === "static") {
      page = await openStatic(parsed.url, mode);
    } else if (use === "playwright") {
      if (!parsed.session) {
        throw new Error("session is required when use='playwright'");
      }
      await getBrowserManager().createSession(parsed.session, false);
      page = await getBrowserManager().openInSession(parsed.session, parsed.url, mode);
    } else {
      try {
        page = await openStatic(parsed.url, mode);
        if (parsed.session && page.actions.length === 0) {
          await getBrowserManager().createSession(parsed.session, false);
          page = await getBrowserManager().openInSession(parsed.session, parsed.url, mode);
        }
      } catch {
        if (!parsed.session) throw new Error("Static open failed and no session was provided for Playwright fallback");
        await getBrowserManager().createSession(parsed.session, false);
        page = await getBrowserManager().openInSession(parsed.session, parsed.url, mode);
      }
    }

    getStore().savePage(page);
    const output = OpenOutputSchema.parse({ page });
    markSuccess("open");
    return output;
  }

  async actionsList(input: unknown) {
    const parsed = ActionsListInputSchema.parse(input);
    const store = getStore();

    let actions;
    if (parsed.session) {
      actions = await getBrowserManager().listActions(parsed);
    } else if (parsed.pageId) {
      const page = store.getPageById(parsed.pageId);
      if (!page) throw new Error(`Page not found for pageId=${parsed.pageId}`);
      actions = page.actions;
    } else {
      const cached = store.getLatestPageByUrl(parsed.url!);
      if (cached) {
        actions = cached.actions;
      } else {
        const opened = await openStatic(parsed.url!, "compact");
        store.savePage(opened);
        actions = opened.actions;
      }
    }

    return ActionsListOutputSchema.parse({ actions });
  }

  async actionsExecute(input: unknown) {
    const parsed = ActionsExecuteInputSchema.parse(input);
    const result = await getBrowserManager().executeAction({
      actionId: parsed.actionId,
      params: parsed.params,
      session: parsed.session,
      returnPage: parsed.returnPage,
      mode: parsed.mode ?? "compact"
    });

    const output = ActionsExecuteOutputSchema.parse(result);
    if (output.outcome.success) {
      markSuccess("action");
    }
    return output;
  }

  async sessionCreate(input: unknown) {
    const parsed = SessionCreateInputSchema.parse(input);
    const session = await getBrowserManager().createSession(parsed.name, parsed.headed ?? false);
    return SessionOutputSchema.parse({ session });
  }

  async sessionSave(input: unknown) {
    const parsed = SessionSaveInputSchema.parse(input);
    const session = await getBrowserManager().saveSession(parsed.name);
    return SessionOutputSchema.parse({ session });
  }

  async crawlStart(input: unknown) {
    const parsed = CrawlStartInputSchema.parse(input);
    const jobId = getCrawlerService().start(parsed.seedUrls, parsed.options);
    markSuccess("crawl");
    return CrawlStartOutputSchema.parse({ jobId });
  }

  async crawlStatus(input: unknown) {
    const parsed = CrawlStatusInputSchema.parse(input);
    const job = getCrawlerService().status(parsed.jobId);
    return CrawlStatusOutputSchema.parse({ job });
  }

  async crawlNext(input: unknown) {
    const parsed = CrawlNextInputSchema.parse(input);
    const pages = getCrawlerService().next(parsed.jobId, parsed.limit ?? 10);
    return CrawlNextOutputSchema.parse({ pages });
  }

  async storeQuery(input: unknown) {
    const parsed = StoreQueryInputSchema.parse(input);
    const hits = getStore().queryPages(parsed.text, parsed.limit ?? 10);
    return StoreQueryOutputSchema.parse({ hits });
  }
}

let singleton: WebxService | undefined;

export function getWebxService(): WebxService {
  if (!singleton) singleton = new WebxService();
  return singleton;
}
