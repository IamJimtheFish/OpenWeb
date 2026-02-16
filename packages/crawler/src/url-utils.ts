const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "ref",
  "ref_src",
  "source",
  "spm"
]);

const NON_HTML_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".svg",
  ".webp",
  ".ico",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".mp3",
  ".mp4",
  ".avi",
  ".mov",
  ".css",
  ".js",
  ".mjs",
  ".json",
  ".xml",
  ".rss",
  ".atom"
];

const NUISANCE_PATH_PATTERNS = [
  "/wp-json/",
  "/api/",
  "/graphql",
  "/cdn-cgi/",
  "/cart",
  "/checkout",
  "/login",
  "/signin",
  "/account",
  "/admin"
];

const NUISANCE_EXACT = new Set(["/robots.txt", "/sitemap.xml", "/ads.txt"]);

export function normalizeCrawlUrl(input: string, base?: string): string | undefined {
  try {
    const url = base ? new URL(input, base) : new URL(input);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;

    url.hash = "";
    url.hostname = url.hostname.toLowerCase();

    if ((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443")) {
      url.port = "";
    }

    const filtered = new URLSearchParams();
    for (const [key, value] of url.searchParams.entries()) {
      const normalizedKey = key.toLowerCase();
      if (normalizedKey.startsWith("utm_")) continue;
      if (TRACKING_PARAMS.has(normalizedKey)) continue;
      filtered.append(key, value);
    }

    const sorted = [...filtered.entries()].sort(([a], [b]) => a.localeCompare(b));
    url.search = "";
    for (const [key, value] of sorted) {
      url.searchParams.append(key, value);
    }

    const cleanedPath = url.pathname.replace(/\/+/g, "/");
    url.pathname = cleanedPath.length > 1 ? cleanedPath.replace(/\/$/, "") : cleanedPath;

    return url.toString();
  } catch {
    return undefined;
  }
}

export function isLikelyCrawlableUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;

  const lowerPath = parsed.pathname.toLowerCase();
  if (NON_HTML_EXTENSIONS.some((ext) => lowerPath.endsWith(ext))) {
    return false;
  }

  return true;
}

export function isNuisanceUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();
    if (NUISANCE_EXACT.has(path)) return true;
    if (NUISANCE_PATH_PATTERNS.some((pattern) => path.includes(pattern))) return true;
    return false;
  } catch {
    return true;
  }
}

export function extractSeedKeywords(seedUrls: string[]): string[] {
  const tokens = new Set<string>();

  for (const url of seedUrls) {
    try {
      const parsed = new URL(url);
      const parts = `${parsed.hostname} ${parsed.pathname}`
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .map((part) => part.trim())
        .filter((part) => part.length >= 3);
      for (const token of parts) {
        if (["www", "http", "https", "index", "html", "php"].includes(token)) continue;
        tokens.add(token);
      }
    } catch {
      // Skip invalid URL tokens.
    }
  }

  return [...tokens].slice(0, 30);
}

export function scoreDiscoveredUrl(
  url: string,
  nextDepth: number,
  context: {
    seedHost: string;
    seedKeywords: string[];
  }
): number {
  try {
    const parsed = new URL(url);
    let score = 100;

    if (parsed.hostname !== context.seedHost) score -= 25;

    const pathDepth = parsed.pathname.split("/").filter(Boolean).length;
    score -= pathDepth * 3;
    score -= nextDepth * 7;

    if (parsed.search) score -= 8;

    const path = `${parsed.hostname}${parsed.pathname}`.toLowerCase();
    const keywordMatches = context.seedKeywords.filter((keyword) => path.includes(keyword)).length;
    score += Math.min(20, keywordMatches * 4);

    if (/(docs|guide|blog|article|help|support|reference)/i.test(path)) score += 6;

    return Math.max(1, Math.min(150, score));
  } catch {
    return 1;
  }
}
