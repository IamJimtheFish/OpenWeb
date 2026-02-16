import type { CrawlJobStatus, CrawlOptions, LLMPage, Mode } from "@webx/types";
import { CrawlOptionsSchema } from "@webx/types";
import { openStatic } from "@webx/core";
import { getStore, type CrawlJobRecord } from "@webx/store";

interface CrawlRuntimeOptions {
  maxPages: number;
  maxDepth: number;
  mode: Mode;
  allowDomains?: string[];
  denyDomains?: string[];
  respectRobots: boolean;
  perDomainDelayMs: number;
}

export class CrawlerService {
  private readonly domainLastFetch = new Map<string, number>();

  start(seedUrls: string[], options?: CrawlOptions): string {
    const normalized = CrawlOptionsSchema.parse(options || {});
    const runtime: CrawlRuntimeOptions = {
      maxPages: normalized.maxPages ?? 100,
      maxDepth: normalized.maxDepth ?? 2,
      mode: normalized.mode ?? "compact",
      allowDomains: normalized.allowDomains,
      denyDomains: normalized.denyDomains,
      respectRobots: normalized.respectRobots ?? true,
      perDomainDelayMs: normalized.perDomainDelayMs ?? 500
    };

    const store = getStore();
    const uniqueSeeds = [...new Set(seedUrls)];
    const jobId = store.createCrawlJob(uniqueSeeds, runtime as unknown as Record<string, unknown>);

    uniqueSeeds.forEach((url, idx) => {
      store.enqueueUrl(jobId, url, 0, 100 - idx);
    });

    store.setCrawlJobStatus(jobId, "running");
    return jobId;
  }

  status(jobId: string): CrawlJobStatus {
    const status = getStore().getCrawlJobStatus(jobId);
    if (!status) {
      throw new Error(`Unknown crawl job: ${jobId}`);
    }
    return status;
  }

  next(jobId: string, limit: number): LLMPage[] {
    return getStore().getCrawlPages(jobId, limit);
  }

  async processActiveJobsOnce(): Promise<void> {
    const jobs = getStore().listActiveCrawlJobs();
    for (const job of jobs) {
      await this.processJobOnce(job);
    }
  }

  private async processJobOnce(job: CrawlJobRecord): Promise<void> {
    const store = getStore();
    const status = store.getCrawlJobStatus(job.id);
    const options = this.toRuntimeOptions(job.options);

    if (!status) {
      return;
    }

    if (status.stats.done >= options.maxPages) {
      store.setCrawlJobStatus(job.id, "finished");
      return;
    }

    const item = store.claimNextQueueItem(job.id);
    if (!item) {
      if (status.stats.queued === 0 && status.stats.processing === 0) {
        store.setCrawlJobStatus(job.id, "finished");
      }
      return;
    }

    try {
      if (item.depth > options.maxDepth) {
        store.completeQueueItem(item.id);
        return;
      }

      const now = Date.now();
      const lastFetch = this.domainLastFetch.get(item.domain) ?? 0;
      const waitMs = Math.max(0, options.perDomainDelayMs - (now - lastFetch));
      if (waitMs > 0) {
        await delay(waitMs);
      }

      const page = await openStatic(item.url, options.mode);
      store.savePage(page);
      store.completeQueueItem(item.id);
      this.domainLastFetch.set(item.domain, Date.now());

      const nextDepth = item.depth + 1;
      if (nextDepth <= options.maxDepth) {
        for (const link of page.links) {
          if (!link.isInternal) continue;
          if (!this.shouldQueue(link.url, options)) continue;
          store.enqueueUrl(job.id, link.url, nextDepth, Math.max(1, 100 - nextDepth));
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      store.failQueueItem(item.id, message);
      const refreshed = store.getCrawlJobStatus(job.id);
      if (refreshed && refreshed.stats.failed > 25 && refreshed.stats.done === 0) {
        store.setCrawlJobStatus(job.id, "failed");
      }
    }
  }

  private toRuntimeOptions(options: Record<string, unknown>): CrawlRuntimeOptions {
    const parsed = CrawlOptionsSchema.parse(options || {});
    return {
      maxPages: parsed.maxPages ?? 100,
      maxDepth: parsed.maxDepth ?? 2,
      mode: parsed.mode ?? "compact",
      allowDomains: parsed.allowDomains,
      denyDomains: parsed.denyDomains,
      respectRobots: parsed.respectRobots ?? true,
      perDomainDelayMs: parsed.perDomainDelayMs ?? 500
    };
  }

  private shouldQueue(url: string, options: CrawlRuntimeOptions): boolean {
    const hostname = new URL(url).hostname;
    if (options.allowDomains?.length && !options.allowDomains.includes(hostname)) {
      return false;
    }
    if (options.denyDomains?.includes(hostname)) {
      return false;
    }
    return true;
  }
}

let singleton: CrawlerService | undefined;

export function getCrawlerService(): CrawlerService {
  if (!singleton) singleton = new CrawlerService();
  return singleton;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
