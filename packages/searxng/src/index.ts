import type { SearchOptions, SearchResult } from "@webx/types";

interface RawSearxResult {
  url?: string;
  title?: string;
  content?: string;
  engine?: string;
  publishedDate?: string;
  published_date?: string;
}

interface RawSearxResponse {
  results?: RawSearxResult[];
}

export class SearxngClient {
  constructor(private readonly baseUrl = process.env.SEARXNG_URL || "http://127.0.0.1:8080") {}

  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    const params = new URLSearchParams({
      q: query,
      format: "json",
      language: options?.language || "en-US"
    });

    if (options?.engines?.length) params.set("engines", options.engines.join(","));
    if (options?.categories?.length) params.set("categories", options.categories.join(","));

    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/search?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`SearXNG request failed: ${response.status} ${response.statusText}`);
    }

    const body = (await response.json()) as RawSearxResponse;
    const limit = options?.limit ?? 5;

    return (body.results || [])
      .filter((item): item is Required<Pick<RawSearxResult, "url" | "title">> & RawSearxResult => {
        return Boolean(item.url && item.title);
      })
      .slice(0, limit)
      .map((item) => ({
        url: item.url,
        title: item.title,
        snippet: item.content || "",
        source: item.engine || "searxng",
        publishedAt: item.publishedDate || item.published_date
      }));
  }
}

let singleton: SearxngClient | undefined;

export function getSearxngClient(): SearxngClient {
  if (!singleton) singleton = new SearxngClient();
  return singleton;
}
