import { normalizeCrawlUrl } from "./url-utils.js";

interface RobotsRuleSet {
  fetchedAt: number;
  allow: string[];
  disallow: string[];
  crawlDelayMs?: number;
  sitemaps: string[];
}

export class RobotsManager {
  private readonly cache = new Map<string, RobotsRuleSet>();

  async getRules(origin: string, userAgent = "OpenWebBot"): Promise<RobotsRuleSet> {
    const normalizedOrigin = origin.replace(/\/$/, "");
    const cached = this.cache.get(normalizedOrigin);
    const now = Date.now();
    if (cached && now - cached.fetchedAt < 6 * 60 * 60 * 1000) {
      return cached;
    }

    const rules = await this.fetchRobotsRules(normalizedOrigin, userAgent);
    this.cache.set(normalizedOrigin, rules);
    return rules;
  }

  canCrawl(url: string, rules: RobotsRuleSet): boolean {
    const parsed = new URL(url);
    const target = `${parsed.pathname}${parsed.search}`;

    const allowLen = longestMatchLength(target, rules.allow);
    const disallowLen = longestMatchLength(target, rules.disallow);

    if (allowLen === 0 && disallowLen === 0) return true;
    return allowLen >= disallowLen;
  }

  getSuggestedDelayMs(baseDelayMs: number, rules: RobotsRuleSet, avgLatencyMs?: number, adaptiveDelay = true): number {
    const robotsDelay = rules.crawlDelayMs ?? 0;
    const adaptive = adaptiveDelay && avgLatencyMs ? Math.round(avgLatencyMs * 1.4) : 0;
    return Math.max(baseDelayMs, robotsDelay, adaptive);
  }

  private async fetchRobotsRules(origin: string, userAgent: string): Promise<RobotsRuleSet> {
    const robotsUrl = `${origin}/robots.txt`;
    try {
      const response = await fetch(robotsUrl, {
        signal: AbortSignal.timeout(8000),
        headers: {
          "user-agent": userAgent
        }
      });

      if (!response.ok) {
        return emptyRules();
      }

      const text = await response.text();
      return parseRobots(text, origin, userAgent);
    } catch {
      return emptyRules();
    }
  }
}

export async function discoverSitemapUrls(
  robots: RobotsRuleSet,
  seedOrigin: string,
  limit = 100
): Promise<string[]> {
  const sitemapUrls = new Set<string>();
  const queue = [...robots.sitemaps];

  if (queue.length === 0) {
    queue.push(`${seedOrigin.replace(/\/$/, "")}/sitemap.xml`);
  }

  let expansions = 0;
  while (queue.length > 0 && sitemapUrls.size < limit && expansions < 12) {
    const sitemap = queue.shift()!;
    expansions += 1;

    try {
      const response = await fetch(sitemap, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) continue;
      const xml = await response.text();

      const locMatches = [...xml.matchAll(/<loc>([^<]+)<\/loc>/gi)].map((match) => match[1].trim());
      const isSitemapIndex = /<sitemapindex/i.test(xml);

      for (const loc of locMatches) {
        const normalized = normalizeCrawlUrl(loc);
        if (!normalized) continue;

        if (isSitemapIndex || /sitemap/i.test(normalized)) {
          if (queue.length < 30) queue.push(normalized);
          continue;
        }

        sitemapUrls.add(normalized);
        if (sitemapUrls.size >= limit) break;
      }
    } catch {
      // Ignore sitemap fetch/parse errors.
    }
  }

  return [...sitemapUrls].slice(0, limit);
}

function parseRobots(content: string, origin: string, userAgent: string): RobotsRuleSet {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, "").trim())
    .filter(Boolean);

  const targetUa = userAgent.toLowerCase();
  let activeForAgent = false;
  let seenRelevantGroup = false;

  const allow: string[] = [];
  const disallow: string[] = [];
  const sitemaps = new Set<string>();
  let crawlDelayMs: number | undefined;

  for (const line of lines) {
    const [rawKey, ...rest] = line.split(":");
    if (!rawKey || rest.length === 0) continue;

    const key = rawKey.trim().toLowerCase();
    const value = rest.join(":").trim();

    if (key === "user-agent") {
      const ua = value.toLowerCase();
      activeForAgent = ua === "*" || ua === targetUa;
      if (activeForAgent) seenRelevantGroup = true;
      continue;
    }

    if (key === "sitemap") {
      const normalized = normalizeCrawlUrl(value, origin);
      if (normalized) sitemaps.add(normalized);
      continue;
    }

    if (!activeForAgent && seenRelevantGroup) {
      continue;
    }

    if (key === "allow") {
      if (value) allow.push(normalizeRobotsPath(value));
      continue;
    }

    if (key === "disallow") {
      if (value) disallow.push(normalizeRobotsPath(value));
      continue;
    }

    if (key === "crawl-delay") {
      const numeric = Number(value);
      if (!Number.isNaN(numeric) && Number.isFinite(numeric) && numeric >= 0) {
        crawlDelayMs = Math.round(numeric * 1000);
      }
    }
  }

  return {
    fetchedAt: Date.now(),
    allow,
    disallow,
    crawlDelayMs,
    sitemaps: [...sitemaps]
  };
}

function normalizeRobotsPath(value: string): string {
  if (!value.startsWith("/")) return `/${value}`;
  return value;
}

function longestMatchLength(target: string, rules: string[]): number {
  let longest = 0;
  for (const rule of rules) {
    if (!rule || rule === "/") continue;
    if (target.startsWith(rule)) {
      longest = Math.max(longest, rule.length);
    }
  }
  return longest;
}

function emptyRules(): RobotsRuleSet {
  return {
    fetchedAt: Date.now(),
    allow: [],
    disallow: [],
    sitemaps: []
  };
}
