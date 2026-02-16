import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import crypto from "node:crypto";
import type { CrawlJobStatus, LLMPage, SessionInfo, StoredPageHit, WebAction } from "@webx/types";

export type QueueStatus = "pending" | "processing" | "done" | "failed";

export interface CrawlQueueItem {
  id: string;
  jobId: string;
  url: string;
  depth: number;
  priority: number;
  nextFetchAt: string;
  domain: string;
  status: QueueStatus;
  retries: number;
  lastError?: string;
}

export interface CrawlJobRecord {
  id: string;
  status: "pending" | "running" | "finished" | "failed";
  seedUrls: string[];
  createdAt: string;
  finishedAt?: string;
  options: Record<string, unknown>;
}

export class WebxStore {
  readonly db: Database.Database;

  constructor(dbPath = path.resolve(process.cwd(), "data/webx.sqlite")) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
  }

  migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS pages (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        canonical_url TEXT,
        title TEXT,
        fetched_at TEXT NOT NULL,
        content_hash TEXT,
        extractor_version TEXT NOT NULL,
        mode TEXT NOT NULL,
        source TEXT NOT NULL,
        page_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_pages_url ON pages(url);
      CREATE INDEX IF NOT EXISTS idx_pages_fetched ON pages(fetched_at DESC);

      CREATE TABLE IF NOT EXISTS links (
        from_page_id TEXT NOT NULL,
        to_url TEXT NOT NULL,
        text TEXT,
        rel TEXT,
        is_internal INTEGER NOT NULL,
        PRIMARY KEY(from_page_id, to_url),
        FOREIGN KEY(from_page_id) REFERENCES pages(id)
      );

      CREATE TABLE IF NOT EXISTS crawl_jobs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        seed_url_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        finished_at TEXT,
        options_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS crawl_queue (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        url TEXT NOT NULL,
        depth INTEGER NOT NULL,
        priority INTEGER NOT NULL,
        next_fetch_at TEXT NOT NULL,
        domain TEXT NOT NULL,
        status TEXT NOT NULL,
        retries INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        FOREIGN KEY(job_id) REFERENCES crawl_jobs(id)
      );
      CREATE INDEX IF NOT EXISTS idx_crawl_queue_job_status ON crawl_queue(job_id, status, next_fetch_at);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_crawl_queue_job_url ON crawl_queue(job_id, url);

      CREATE TABLE IF NOT EXISTS sessions (
        name TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        storage_state_path TEXT NOT NULL,
        notes TEXT,
        headed INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS actions_log (
        id TEXT PRIMARY KEY,
        session_name TEXT NOT NULL,
        url TEXT NOT NULL,
        action_json TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    this.db.prepare("INSERT OR REPLACE INTO schema_meta(key,value) VALUES('db_schema_version','1')").run();
  }

  getSchemaVersion(): number {
    const row = this.db.prepare("SELECT value FROM schema_meta WHERE key='db_schema_version'").get() as
      | { value: string }
      | undefined;
    return row ? Number(row.value) : 0;
  }

  setMeta(key: string, value: string): void {
    this.db.prepare("INSERT OR REPLACE INTO schema_meta(key,value) VALUES(?, ?)").run(key, value);
  }

  getMeta(key: string): string | undefined {
    const row = this.db.prepare("SELECT value FROM schema_meta WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value;
  }

  savePage(page: LLMPage): void {
    const pageId = page.id || this.makeId(page.url);
    const contentHash = page.contentHash || this.hash(`${page.title}\n${page.keyParagraphs.join("\n")}`);
    this.db
      .prepare(`
        INSERT OR REPLACE INTO pages
          (id, url, canonical_url, title, fetched_at, content_hash, extractor_version, mode, source, page_json)
        VALUES
          (@id, @url, @canonical_url, @title, @fetched_at, @content_hash, @extractor_version, @mode, @source, @page_json)
      `)
      .run({
        id: pageId,
        url: page.url,
        canonical_url: page.canonicalUrl ?? null,
        title: page.title,
        fetched_at: page.fetchedAt,
        content_hash: contentHash,
        extractor_version: page.extractorVersion,
        mode: page.mode,
        source: page.source,
        page_json: JSON.stringify({ ...page, id: pageId, contentHash })
      });

    const insertLink = this.db.prepare(
      "INSERT OR REPLACE INTO links(from_page_id,to_url,text,rel,is_internal) VALUES(@from_page_id,@to_url,@text,@rel,@is_internal)"
    );
    const tx = this.db.transaction((links: LLMPage["links"]) => {
      for (const link of links) {
        insertLink.run({
          from_page_id: pageId,
          to_url: link.url,
          text: link.text,
          rel: link.rel ?? null,
          is_internal: link.isInternal ? 1 : 0
        });
      }
    });
    tx(page.links);
  }

  getPageById(id: string): LLMPage | undefined {
    const row = this.db.prepare("SELECT page_json FROM pages WHERE id = ?").get(id) as { page_json: string } | undefined;
    return row ? (JSON.parse(row.page_json) as LLMPage) : undefined;
  }

  getLatestPageByUrl(url: string): LLMPage | undefined {
    const row = this.db
      .prepare("SELECT page_json FROM pages WHERE url = ? ORDER BY fetched_at DESC LIMIT 1")
      .get(url) as { page_json: string } | undefined;
    return row ? (JSON.parse(row.page_json) as LLMPage) : undefined;
  }

  queryPages(text: string, limit = 10): StoredPageHit[] {
    const pattern = `%${text}%`;
    const rows = this.db
      .prepare(
        `
      SELECT id, url, title, fetched_at, page_json
      FROM pages
      WHERE title LIKE ? OR page_json LIKE ?
      ORDER BY fetched_at DESC
      LIMIT ?
    `
      )
      .all(pattern, pattern, limit) as Array<{ id: string; url: string; title: string; fetched_at: string; page_json: string }>;

    return rows.map((row, idx) => {
      const parsed = JSON.parse(row.page_json) as LLMPage;
      const snippet = parsed.keyParagraphs[0] ?? "";
      const score = Math.max(0, 1 - idx * 0.05);
      return { id: row.id, url: row.url, title: row.title ?? "", snippet, fetchedAt: row.fetched_at, score };
    });
  }

  createCrawlJob(seedUrls: string[], options: Record<string, unknown>): string {
    const id = this.makeId(seedUrls.join("|"));
    const now = new Date().toISOString();
    this.db
      .prepare(
        `
      INSERT INTO crawl_jobs (id, status, seed_url_json, created_at, finished_at, options_json)
      VALUES (?, 'pending', ?, ?, NULL, ?)
    `
      )
      .run(id, JSON.stringify(seedUrls), now, JSON.stringify(options));
    return id;
  }

  setCrawlJobStatus(jobId: string, status: "pending" | "running" | "finished" | "failed"): void {
    const finishedAt = status === "finished" || status === "failed" ? new Date().toISOString() : null;
    this.db.prepare("UPDATE crawl_jobs SET status = ?, finished_at = ? WHERE id = ?").run(status, finishedAt, jobId);
  }

  getCrawlJob(jobId: string): CrawlJobRecord | undefined {
    const row = this.db
      .prepare("SELECT id, status, seed_url_json, created_at, finished_at, options_json FROM crawl_jobs WHERE id = ?")
      .get(jobId) as
      | {
          id: string;
          status: CrawlJobRecord["status"];
          seed_url_json: string;
          created_at: string;
          finished_at: string | null;
          options_json: string;
        }
      | undefined;

    if (!row) return undefined;
    return {
      id: row.id,
      status: row.status,
      seedUrls: JSON.parse(row.seed_url_json) as string[],
      createdAt: row.created_at,
      finishedAt: row.finished_at ?? undefined,
      options: JSON.parse(row.options_json) as Record<string, unknown>
    };
  }

  listActiveCrawlJobs(): CrawlJobRecord[] {
    const rows = this.db
      .prepare(
        "SELECT id, status, seed_url_json, created_at, finished_at, options_json FROM crawl_jobs WHERE status IN ('pending','running') ORDER BY created_at ASC"
      )
      .all() as Array<{
      id: string;
      status: CrawlJobRecord["status"];
      seed_url_json: string;
      created_at: string;
      finished_at: string | null;
      options_json: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      status: row.status,
      seedUrls: JSON.parse(row.seed_url_json) as string[],
      createdAt: row.created_at,
      finishedAt: row.finished_at ?? undefined,
      options: JSON.parse(row.options_json) as Record<string, unknown>
    }));
  }

  enqueueUrl(jobId: string, url: string, depth: number, priority: number): void {
    const domain = new URL(url).hostname;
    const id = this.stableId(`${jobId}:${url}`);
    this.db
      .prepare(
        `
      INSERT OR IGNORE INTO crawl_queue (id, job_id, url, depth, priority, next_fetch_at, domain, status, retries)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0)
    `
      )
      .run(id, jobId, url, depth, priority, new Date().toISOString(), domain);
  }

  claimNextQueueItem(jobId: string): CrawlQueueItem | undefined {
    const row = this.db
      .prepare(
        `
      SELECT * FROM crawl_queue
      WHERE job_id = ? AND status = 'pending' AND next_fetch_at <= ?
      ORDER BY priority DESC, depth ASC, next_fetch_at ASC
      LIMIT 1
    `
      )
      .get(jobId, new Date().toISOString()) as CrawlQueueItem | undefined;

    if (!row) {
      return undefined;
    }

    this.db.prepare("UPDATE crawl_queue SET status='processing' WHERE id = ?").run(row.id);
    return { ...row, status: "processing" };
  }

  completeQueueItem(id: string): void {
    this.db.prepare("UPDATE crawl_queue SET status='done' WHERE id = ?").run(id);
  }

  failQueueItem(id: string, error: string, retryDelayMs = 1500): void {
    const row = this.db.prepare("SELECT retries FROM crawl_queue WHERE id = ?").get(id) as { retries: number } | undefined;
    const retries = (row?.retries ?? 0) + 1;
    if (retries >= 3) {
      this.db.prepare("UPDATE crawl_queue SET status='failed', retries=?, last_error=? WHERE id=?").run(retries, error, id);
      return;
    }
    const nextFetchAt = new Date(Date.now() + retryDelayMs * retries).toISOString();
    this.db
      .prepare("UPDATE crawl_queue SET status='pending', retries=?, last_error=?, next_fetch_at=? WHERE id=?")
      .run(retries, error, nextFetchAt, id);
  }

  getCrawlJobStatus(jobId: string): CrawlJobStatus | undefined {
    const job = this.db
      .prepare("SELECT id, status, created_at, finished_at FROM crawl_jobs WHERE id = ?")
      .get(jobId) as { id: string; status: CrawlJobStatus["status"]; created_at: string; finished_at: string | null } | undefined;
    if (!job) {
      return undefined;
    }

    const statsRows = this.db
      .prepare("SELECT status, COUNT(*) as count FROM crawl_queue WHERE job_id = ? GROUP BY status")
      .all(jobId) as Array<{ status: QueueStatus; count: number }>;

    const stats = {
      queued: 0,
      processing: 0,
      done: 0,
      failed: 0
    };
    for (const row of statsRows) {
      if (row.status === "pending") stats.queued = row.count;
      if (row.status === "processing") stats.processing = row.count;
      if (row.status === "done") stats.done = row.count;
      if (row.status === "failed") stats.failed = row.count;
    }

    return {
      id: job.id,
      status: job.status,
      createdAt: job.created_at,
      finishedAt: job.finished_at ?? undefined,
      stats
    };
  }

  getCrawlPages(jobId: string, limit = 10): LLMPage[] {
    const rows = this.db
      .prepare(
        `
      SELECT p.page_json
      FROM crawl_queue q
      INNER JOIN pages p ON p.url = q.url
      WHERE q.job_id = ? AND q.status = 'done'
      ORDER BY p.fetched_at DESC
      LIMIT ?
    `
      )
      .all(jobId, limit) as Array<{ page_json: string }>;
    return rows.map((row) => JSON.parse(row.page_json) as LLMPage);
  }

  saveSession(session: SessionInfo): SessionInfo {
    this.db
      .prepare(
        `
      INSERT INTO sessions(name, created_at, updated_at, storage_state_path, notes, headed)
      VALUES (@name, @created_at, @updated_at, @storage_state_path, @notes, @headed)
      ON CONFLICT(name) DO UPDATE SET
        updated_at=excluded.updated_at,
        storage_state_path=excluded.storage_state_path,
        notes=excluded.notes,
        headed=excluded.headed
    `
      )
      .run({
        name: session.name,
        created_at: session.createdAt,
        updated_at: session.updatedAt,
        storage_state_path: session.storageStatePath,
        notes: session.notes ?? null,
        headed: session.headed ? 1 : 0
      });
    return session;
  }

  getSession(name: string): SessionInfo | undefined {
    const row = this.db
      .prepare("SELECT name, created_at, updated_at, storage_state_path, notes, headed FROM sessions WHERE name = ?")
      .get(name) as
      | {
          name: string;
          created_at: string;
          updated_at: string;
          storage_state_path: string;
          notes: string | null;
          headed: number;
        }
      | undefined;
    if (!row) {
      return undefined;
    }
    return {
      name: row.name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      storageStatePath: row.storage_state_path,
      notes: row.notes ?? undefined,
      headed: Boolean(row.headed)
    };
  }

  logAction(sessionName: string, url: string, action: WebAction, result: Record<string, unknown>): void {
    this.db
      .prepare(
        `
      INSERT INTO actions_log(id, session_name, url, action_json, result_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        this.makeId(`${sessionName}:${url}:${action.id}:${Date.now()}`),
        sessionName,
        url,
        JSON.stringify(action),
        JSON.stringify(result),
        new Date().toISOString()
      );
  }

  private makeId(seed: string): string {
    return this.hash(`${seed}:${Date.now()}`);
  }

  private stableId(seed: string): string {
    return this.hash(seed);
  }

  private hash(input: string): string {
    return crypto.createHash("sha256").update(input).digest("hex").slice(0, 16);
  }
}

let singleton: WebxStore | undefined;

export function getStore(): WebxStore {
  if (!singleton) {
    singleton = new WebxStore();
    singleton.migrate();
  }
  return singleton;
}
