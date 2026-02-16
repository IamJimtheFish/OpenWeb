import { describe, expect, it } from "vitest";
import { extractSeedKeywords, isLikelyCrawlableUrl, normalizeCrawlUrl, scoreDiscoveredUrl } from "../packages/crawler/src/url-utils";

describe("crawler url utilities", () => {
  it("normalizes tracking params and fragments", () => {
    const normalized = normalizeCrawlUrl("https://Example.com/docs/page/?utm_source=x&b=2&a=1#section");
    expect(normalized).toBe("https://example.com/docs/page?a=1&b=2");
  });

  it("rejects likely binary assets", () => {
    expect(isLikelyCrawlableUrl("https://example.com/file.pdf")).toBe(false);
    expect(isLikelyCrawlableUrl("https://example.com/docs/guide")).toBe(true);
  });

  it("scores URLs with matching seed keywords higher", () => {
    const keywords = extractSeedKeywords(["https://example.com/docs/platform"]);
    const matched = scoreDiscoveredUrl("https://example.com/docs/platform/setup", 1, {
      seedHost: "example.com",
      seedKeywords: keywords
    });
    const unrelated = scoreDiscoveredUrl("https://example.com/random/path", 1, {
      seedHost: "example.com",
      seedKeywords: keywords
    });
    expect(matched).toBeGreaterThan(unrelated);
  });
});
