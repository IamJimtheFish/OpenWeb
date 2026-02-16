import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { ActionOutcome, LLMPage, Mode, SessionInfo, WebAction } from "@webx/types";
import { extractPageFromHtml } from "@webx/core";
import { getStore } from "@webx/store";

interface ActiveSession {
  name: string;
  headed: boolean;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  storagePath: string;
  actions: Map<string, WebAction>;
  lastUrl?: string;
}

export class BrowserManager {
  private sessions = new Map<string, ActiveSession>();

  async createSession(name: string, headed = false): Promise<SessionInfo> {
    const existing = this.sessions.get(name);
    if (existing) {
      return this.toInfo(existing);
    }

    const sessionDir = path.resolve(process.cwd(), `data/sessions/${name}`);
    fs.mkdirSync(sessionDir, { recursive: true });
    const storagePath = path.join(sessionDir, "storageState.json");

    const browser = await chromium.launch({ headless: !headed });
    const context = await browser.newContext(
      fs.existsSync(storagePath)
        ? {
            storageState: storagePath
          }
        : {}
    );
    const page = await context.newPage();

    const active: ActiveSession = {
      name,
      headed,
      browser,
      context,
      page,
      storagePath,
      actions: new Map()
    };

    this.sessions.set(name, active);
    const info = this.toInfo(active);
    getStore().saveSession(info);
    return info;
  }

  async saveSession(name: string): Promise<SessionInfo> {
    const session = await this.requireSession(name);
    await session.context.storageState({ path: session.storagePath });
    const info = this.toInfo(session);
    getStore().saveSession(info);
    return info;
  }

  async closeAll(): Promise<void> {
    for (const [, session] of this.sessions) {
      await session.context.close();
      await session.browser.close();
    }
    this.sessions.clear();
  }

  async openInSession(name: string, url: string, mode: Mode): Promise<LLMPage> {
    const session = await this.requireSession(name);
    await session.page.goto(url, { waitUntil: "domcontentloaded" });
    await session.page.waitForTimeout(250);
    const html = await session.page.content();
    const page = extractPageFromHtml({ url: session.page.url(), html, mode, source: "playwright" });
    session.lastUrl = session.page.url();
    session.actions = new Map(page.actions.map((action) => [action.id, action]));
    getStore().savePage(page);
    return page;
  }

  async listActions(input: { url?: string; pageId?: string; session?: string }): Promise<WebAction[]> {
    const store = getStore();

    if (input.pageId) {
      const page = store.getPageById(input.pageId);
      if (!page) {
        throw new Error(`Page not found for pageId=${input.pageId}`);
      }
      if (input.session) {
        const session = await this.requireSession(input.session);
        session.actions = new Map(page.actions.map((action) => [action.id, action]));
      }
      return page.actions;
    }

    if (!input.url) {
      throw new Error("url or pageId required");
    }

    if (input.session) {
      const page = await this.openInSession(input.session, input.url, "compact");
      return page.actions;
    }

    const page = store.getLatestPageByUrl(input.url);
    if (!page) {
      throw new Error("No stored page for URL. Open page first or provide session.");
    }
    return page.actions;
  }

  async executeAction(input: {
    actionId: string;
    params?: Record<string, unknown>;
    session: string;
    returnPage?: boolean;
    mode: Mode;
  }): Promise<{ outcome: ActionOutcome; page?: LLMPage }> {
    const session = await this.requireSession(input.session);
    const action = session.actions.get(input.actionId);
    if (!action) {
      throw new Error(`Unknown actionId ${input.actionId}. Call actions.list first.`);
    }

    try {
      switch (action.type) {
        case "click":
          await session.page.click(action.selector);
          break;
        case "submit":
          await session.page.click(action.selector);
          break;
        case "navigate":
          await session.page.click(action.selector);
          break;
        case "fill": {
          const value = String(input.params?.value ?? "");
          await session.page.fill(action.selector, value);
          break;
        }
        case "select": {
          const value = String(input.params?.value ?? "");
          await session.page.selectOption(action.selector, value);
          break;
        }
        default:
          throw new Error(`Unsupported action type ${(action as { type: string }).type}`);
      }

      await session.page.waitForLoadState("domcontentloaded", { timeout: 4000 }).catch(() => undefined);
      await session.page.waitForTimeout(200);

      const outcome: ActionOutcome = {
        success: true,
        message: `Executed action ${action.id}`,
        diagnostics: {
          type: action.type,
          url: session.page.url()
        }
      };

      let page: LLMPage | undefined;
      if (input.returnPage) {
        const html = await session.page.content();
        page = extractPageFromHtml({ url: session.page.url(), html, mode: input.mode, source: "playwright" });
        session.actions = new Map(page.actions.map((item) => [item.id, item]));
        getStore().savePage(page);
      }

      getStore().logAction(input.session, session.page.url(), action, {
        success: true,
        type: action.type,
        params: input.params ?? {}
      });
      return { outcome, page };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      getStore().logAction(input.session, session.page.url(), action, {
        success: false,
        error: message,
        params: input.params ?? {}
      });
      return {
        outcome: {
          success: false,
          message,
          diagnostics: {
            type: action.type,
            url: session.page.url()
          }
        }
      };
    }
  }

  private async requireSession(name: string): Promise<ActiveSession> {
    let session = this.sessions.get(name);
    if (!session) {
      const saved = getStore().getSession(name);
      session = await this.createSession(name, saved?.headed ?? false).then(() => this.sessions.get(name));
    }
    if (!session) {
      throw new Error(`Failed to create session ${name}`);
    }
    return session;
  }

  private toInfo(session: ActiveSession): SessionInfo {
    const now = new Date().toISOString();
    const existing = getStore().getSession(session.name);
    return {
      name: session.name,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      storageStatePath: session.storagePath,
      headed: session.headed
    };
  }
}

let singleton: BrowserManager | undefined;

export function getBrowserManager(): BrowserManager {
  if (!singleton) {
    singleton = new BrowserManager();
  }
  return singleton;
}
