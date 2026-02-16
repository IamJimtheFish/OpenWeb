import crypto from "node:crypto";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import * as cheerio from "cheerio";
import type { LLMPage, Mode, WebAction } from "@webx/types";

const EXTRACTOR_VERSION = "v1";

export interface ExtractOptions {
  url: string;
  html: string;
  mode: Mode;
  source: "static" | "playwright";
}

function normalizeUrl(baseUrl: string, candidate?: string): string | undefined {
  if (!candidate) return undefined;
  try {
    return new URL(candidate, baseUrl).toString();
  } catch {
    return undefined;
  }
}

function readableText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function buildId(seed: string): string {
  return crypto.createHash("sha256").update(seed).digest("hex").slice(0, 16);
}

function cssEscape(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}

function summarizeWithReadability(html: string): { title: string; paragraphs: string[] } {
  const dom = new JSDOM(html);
  const article = new Readability(dom.window.document).parse();
  if (!article) {
    return { title: "", paragraphs: [] };
  }

  const $ = cheerio.load(article.content ?? "");
  const paragraphs = $("p")
    .toArray()
    .map((p) => readableText($(p).text()))
    .filter((v) => v.length > 40)
    .slice(0, 20);

  return {
    title: article.title ?? "",
    paragraphs
  };
}

function extractLinks(baseUrl: string, $: cheerio.CheerioAPI, mode: Mode): LLMPage["links"] {
  const maxLinks = mode === "compact" ? 25 : 80;
  return $("a[href]")
    .toArray()
    .map((a) => {
      const url = normalizeUrl(baseUrl, $(a).attr("href"));
      const text = readableText($(a).text());
      if (!url || !text) return undefined;
      const isInternal = new URL(url).hostname === new URL(baseUrl).hostname;
      return {
        url,
        text: text.slice(0, 160),
        rel: $(a).attr("rel"),
        isInternal
      };
    })
    .filter((v): v is NonNullable<typeof v> => Boolean(v))
    .slice(0, maxLinks);
}

function extractForms(baseUrl: string, $: cheerio.CheerioAPI): LLMPage["forms"] {
  return $("form")
    .toArray()
    .map((form, idx) => {
      const node = $(form);
      const id = node.attr("id") || `form_${idx + 1}`;
      const fields = node
        .find("input, textarea, select")
        .toArray()
        .map((field) => {
          const fieldNode = $(field);
          return {
            name: fieldNode.attr("name"),
            type: fieldNode.attr("type") || field.name || "text",
            required: fieldNode.is("[required]"),
            placeholder: fieldNode.attr("placeholder"),
            label: fieldNode.attr("aria-label") || undefined
          };
        });

      return {
        id,
        action: normalizeUrl(baseUrl, node.attr("action")),
        method: (node.attr("method") || "get").toLowerCase(),
        fields
      };
    });
}

export function extractActionsFromHtml(baseUrl: string, html: string): WebAction[] {
  const $ = cheerio.load(html);
  const actions: WebAction[] = [];

  $("a[href], button, input[type='submit'], form, input, textarea, select")
    .toArray()
    .slice(0, 150)
    .forEach((node, index) => {
      const el = $(node);
      const tag = node.tagName.toLowerCase();
      const text = readableText(el.text() || el.attr("aria-label") || el.attr("name") || el.attr("id") || tag);
      const selector = buildSelector(node, index, $);
      if (!selector) return;

      if (tag === "a") {
        const href = normalizeUrl(baseUrl, el.attr("href"));
        if (!href) return;
        actions.push({
          id: buildId(`nav:${selector}:${href}`),
          type: "navigate",
          label: text || href,
          selector,
          paramsSchema: {
            type: "object",
            properties: {},
            required: []
          }
        });
        return;
      }

      if (tag === "form" || tag === "button" || (tag === "input" && (el.attr("type") || "") === "submit")) {
        actions.push({
          id: buildId(`submit:${selector}`),
          type: "submit",
          label: text || "Submit",
          selector,
          paramsSchema: {
            type: "object",
            properties: {},
            required: []
          }
        });
        return;
      }

      if (tag === "select") {
        actions.push({
          id: buildId(`select:${selector}`),
          type: "select",
          label: text || "Select field",
          selector,
          paramsSchema: {
            type: "object",
            properties: {
              value: { type: "string" }
            },
            required: ["value"]
          }
        });
        return;
      }

      if (tag === "input" || tag === "textarea") {
        actions.push({
          id: buildId(`fill:${selector}`),
          type: "fill",
          label: text || "Input field",
          selector,
          paramsSchema: {
            type: "object",
            properties: {
              value: { type: "string" }
            },
            required: ["value"]
          }
        });
      }
    });

  const dedup = new Map<string, WebAction>();
  for (const action of actions) {
    if (!dedup.has(action.id)) dedup.set(action.id, action);
  }
  return [...dedup.values()].slice(0, 80);
}

function buildSelector(node: any, index: number, $: cheerio.CheerioAPI): string | undefined {
  if (!(node as { tagName?: string }).tagName) {
    return undefined;
  }
  const tagName = (node as { tagName: string }).tagName;
  const el = $(node);
  const id = el.attr("id");
  if (id) return `#${cssEscape(id)}`;

  const name = el.attr("name");
  if (name) return `${tagName}[name="${escapeQuotes(name)}"]`;

  const aria = el.attr("aria-label");
  if (aria) return `${tagName}[aria-label="${escapeQuotes(aria)}"]`;

  const classes = (el.attr("class") || "")
    .split(/\s+/)
    .map((c) => c.trim())
    .filter(Boolean)
    .slice(0, 2);
  if (classes.length > 0) {
    return `${tagName}.${classes.map((c) => cssEscape(c)).join(".")}`;
  }

  return `${tagName}:nth-of-type(${Math.max(1, index + 1)})`;
}

function escapeQuotes(value: string): string {
  return value.replace(/"/g, '\\"');
}

export function extractPageFromHtml({ url, html, mode, source }: ExtractOptions): LLMPage {
  const $ = cheerio.load(html);
  const canonicalUrl = normalizeUrl(url, $("link[rel='canonical']").attr("href"));
  const headings = $("h1, h2, h3")
    .toArray()
    .map((h) => readableText($(h).text()))
    .filter(Boolean)
    .slice(0, mode === "compact" ? 12 : 40);

  const readability = summarizeWithReadability(html);
  const paragraphCap = mode === "compact" ? 10 : 35;
  const keyParagraphs = readability.paragraphs.slice(0, paragraphCap);

  const links = extractLinks(url, $, mode);
  const forms = extractForms(url, $);
  const actions = extractActionsFromHtml(url, html);

  const now = new Date().toISOString();
  const title = readableText(readability.title || $("title").first().text());
  const contentHash = buildId(`${title}\n${keyParagraphs.join("\n")}`);
  const id = buildId(`${url}:${contentHash}:${now}`);

  return {
    id,
    url,
    canonicalUrl,
    title,
    fetchedAt: now,
    contentHash,
    extractorVersion: EXTRACTOR_VERSION,
    mode,
    source,
    headings,
    keyParagraphs,
    links,
    forms,
    actions
  };
}

export async function openStatic(url: string, mode: Mode): Promise<LLMPage> {
  const response = await fetch(url, {
    headers: {
      "user-agent": "WebX/0.1 (+https://localhost)"
    },
    redirect: "follow"
  });
  if (!response.ok) {
    throw new Error(`Static fetch failed: ${response.status} ${response.statusText}`);
  }
  const html = await response.text();
  return extractPageFromHtml({ url: response.url || url, html, mode, source: "static" });
}
