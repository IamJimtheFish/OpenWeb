import type { CrawlJobStatus, CrawlOptions, LLMPage, Mode } from "@webx/types";
import { CrawlOptionsSchema } from "@webx/types";
import { openStatic } from "@webx/core";
import { getStore, type CrawlJobRecord } from "@webx/store";
import { RobotsManager, discoverSitemapUrls } from "./robots.js";
import {
  extractSeedKeywords,
  isLikelyCrawlableUrl,
  isNuisanceUrl,
  normalizeCrawlUrl,
  scoreDiscoveredUrl
} from "./url-utils.js";

interface CrawlRuntimeOptions {
  maxPages: number;
  maxDepth: number;
  mode: Mode;
  allowDomains?: string[];
  denyDomains?: string[];
  respectRobots: boolean;
  perDomainDelayMs: number;
  seedFromSitemaps: boolean;
  maxSitemapUrls: number;
  adaptiveDelay: boolean;
}

interface DomainPerformance {
  avgLatencyMs: number;
  samples: number;
}

export class CrawlerService {
  private readonly domainLastFetch = new Map<string, number>();
  private readonly domainPerformance = new Map<string, DomainPerformance>();
  private readonly initializedJobs = new Set<string>();
  private readonly robotsManager = new RobotsManager();
  private readonly sitemapCache = new Map<string, { expiresAt: number; urls: string[] }>();

  start(seedUrls: string[], options?: CrawlOptions): string {
    const runtime = this.toRuntimeOptions(options || {});
    const normalizedSeeds = [...new Set(seedUrls.map((url) => normalizeCrawlUrl(url)).filter((url): url is string => Boolean(url)))];

    if (normalizedSeeds.length === 0) {
      throw new Error("At least one valid seed URL is required");
    }

    const store = getStore();
    const jobId = store.createCrawlJob(normalizedSeeds, runtime as unknown as Record<string, unknown>);

    normalizedSeeds.forEach((url, idx) => {
      store.enqueueUrl(jobId, url, 0, 140 - idx);
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

    if (!status) return;

    if (status.stats.done >= options.maxPages) {
      store.setCrawlJobStatus(job.id, "finished");
      return;
    }

    await this.initializeJobIfNeeded(job, options);

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

      const normalizedUrl = normalizeCrawlUrl(item.url);
      if (!normalizedUrl || !this.shouldQueue(normalizedUrl, options, job.seedUrls)) {
        store.completeQueueItem(item.id);
        return;
      }

      let robotsRules:
        | {
            crawlDelayMs?: number;
            allow: string[];
            disallow: string[];
            sitemaps: string[];
            fetchedAt: number;
          }
        | undefined;

      if (options.respectRobots) {
        robotsRules = await this.robotsManager.getRules(new URL(normalizedUrl).origin);
        if (!this.robotsManager.canCrawl(normalizedUrl, robotsRules)) {
          store.completeQueueItem(item.id);
          return;
        }
      }

      const now = Date.now();
      const lastFetch = this.domainLastFetch.get(item.domain) ?? 0;
      const domainPerf = this.domainPerformance.get(item.domain);
      const domainDelayMs = this.robotsManager.getSuggestedDelayMs(
        options.perDomainDelayMs,
        robotsRules ?? { fetchedAt: now, allow: [], disallow: [], sitemaps: [] },
        domainPerf?.avgLatencyMs,
        options.adaptiveDelay
      );
      const waitMs = Math.max(0, domainDelayMs - (now - lastFetch));
      if (waitMs > 0) {
        await delay(waitMs);
      }

      const startedAt = Date.now();
      const page = await openStatic(normalizedUrl, options.mode);
      const fetchLatency = Date.now() - startedAt;
      this.updateDomainPerformance(item.domain, fetchLatency);

      const previous = store.getLatestPageByUrl(page.url) ?? store.getLatestPageByUrl(normalizedUrl);
      const unchanged = Boolean(previous?.contentHash && previous.contentHash === page.contentHash);
      if (!unchanged) {
        store.savePage(page);
      }

      store.completeQueueItem(item.id);
      this.domainLastFetch.set(item.domain, Date.now());

      const nextDepth = item.depth + 1;
      if (nextDepth <= options.maxDepth) {
        const seedHost = new URL(job.seedUrls[0]).hostname;
        const seedKeywords = extractSeedKeywords(job.seedUrls);

        for (const link of page.links) {
          const normalizedLink = normalizeCrawlUrl(link.url, page.url);
          if (!normalizedLink) continue;
          if (!this.shouldQueue(normalizedLink, options, job.seedUrls)) continue;

          const priority = scoreDiscoveredUrl(normalizedLink, nextDepth, {
            seedHost,
            seedKeywords
          });
          store.enqueueUrl(job.id, normalizedLink, nextDepth, priority);
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
      maxPages: parsed.maxPages,
      maxDepth: parsed.maxDepth,
      mode: parsed.mode,
      allowDomains: parsed.allowDomains,
      denyDomains: parsed.denyDomains,
      respectRobots: parsed.respectRobots,
      perDomainDelayMs: parsed.perDomainDelayMs,
      seedFromSitemaps: parsed.seedFromSitemaps,
      maxSitemapUrls: parsed.maxSitemapUrls,
      adaptiveDelay: parsed.adaptiveDelay
    };
  }

  private shouldQueue(url: string, options: CrawlRuntimeOptions, seedUrls: string[]): boolean {
    if (!isLikelyCrawlableUrl(url)) return false;
    if (isNuisanceUrl(url)) return false;

    const hostname = new URL(url).hostname;
    const seedHosts = new Set(seedUrls.map((seed) => new URL(seed).hostname));

    const allowDomains = options.allowDomains?.length ? new Set(options.allowDomains) : seedHosts;
    if (!allowDomains.has(hostname)) {
      return false;
    }

    if (options.denyDomains?.includes(hostname)) {
      return false;
    }

    return true;
  }

  private updateDomainPerformance(domain: string, latencyMs: number): void {
    const existing = this.domainPerformance.get(domain);
    if (!existing) {
      this.domainPerformance.set(domain, { avgLatencyMs: latencyMs, samples: 1 });
      return;
    }

    const nextSamples = Math.min(50, existing.samples + 1);
    const nextAvg = Math.round((existing.avgLatencyMs * existing.samples + latencyMs) / (existing.samples + 1));
    this.domainPerformance.set(domain, {
      avgLatencyMs: nextAvg,
      samples: nextSamples
    });
  }

  private async initializeJobIfNeeded(job: CrawlJobRecord, options: CrawlRuntimeOptions): Promise<void> {
    if (this.initializedJobs.has(job.id)) return;
    this.initializedJobs.add(job.id);

    if (!options.seedFromSitemaps) return;

    const store = getStore();
    const uniqueOrigins = [...new Set(job.seedUrls.map((url) => new URL(url).origin))];

    for (const origin of uniqueOrigins.slice(0, 6)) {
      try {
        const robotsRules = options.respectRobots
          ? await this.robotsManager.getRules(origin)
          : { fetchedAt: Date.now(), allow: [], disallow: [], sitemaps: [] };

        const sitemapUrls = await this.getSitemapUrlsCached(origin, robotsRules, options.maxSitemapUrls);
        for (const sitemapUrl of sitemapUrls) {
          if (!this.shouldQueue(sitemapUrl, options, job.seedUrls)) continue;
          store.enqueueUrl(job.id, sitemapUrl, 0, 120);
        }
      } catch {
        // Ignore initialization errors to keep the crawl running.
      }
    }
  }

  private async getSitemapUrlsCached(
    origin: string,
    robotsRules: { fetchedAt: number; allow: string[]; disallow: string[]; crawlDelayMs?: number; sitemaps: string[] },
    limit: number
  ): Promise<string[]> {
    const cached = this.sitemapCache.get(origin);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return cached.urls.slice(0, limit);
    }

    const urls = await discoverSitemapUrls(robotsRules, origin, limit);
    this.sitemapCache.set(origin, {
      urls,
      expiresAt: now + 6 * 60 * 60 * 1000
    });
    return urls;
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
