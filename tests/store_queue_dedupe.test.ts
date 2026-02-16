import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WebxStore } from "@webx/store";

const createdPaths: string[] = [];

afterEach(() => {
  for (const p of createdPaths.splice(0, createdPaths.length)) {
    try {
      fs.rmSync(p, { force: true });
      fs.rmSync(`${p}-wal`, { force: true });
      fs.rmSync(`${p}-shm`, { force: true });
    } catch {
      // ignore cleanup errors in tests
    }
  }
});

describe("crawl queue dedupe", () => {
  it("does not enqueue duplicate URLs for the same job", () => {
    const dbPath = path.join(os.tmpdir(), `webx-store-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`);
    createdPaths.push(dbPath);

    const store = new WebxStore(dbPath);
    store.migrate();

    const jobId = store.createCrawlJob(["https://example.com"], {});
    store.enqueueUrl(jobId, "https://example.com/docs", 0, 100);
    store.enqueueUrl(jobId, "https://example.com/docs", 0, 80);

    const row = store.db
      .prepare("SELECT COUNT(*) as count FROM crawl_queue WHERE job_id = ? AND url = ?")
      .get(jobId, "https://example.com/docs") as { count: number };

    expect(row.count).toBe(1);
  });
});
