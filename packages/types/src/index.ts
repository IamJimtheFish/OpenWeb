import { z } from "zod";

export const ModeSchema = z.enum(["compact", "full"]);
export type Mode = z.infer<typeof ModeSchema>;

export const UseSchema = z.enum(["auto", "static", "playwright"]);
export type OpenUse = z.infer<typeof UseSchema>;

export const ActionTypeSchema = z.enum(["click", "fill", "select", "submit", "navigate"]);
export type ActionType = z.infer<typeof ActionTypeSchema>;

export const SearchOptionsSchema = z.object({
  limit: z.number().int().min(1).max(20).default(5),
  engines: z.array(z.string()).optional(),
  categories: z.array(z.string()).optional(),
  language: z.string().optional()
});

export const SearchResultSchema = z.object({
  url: z.string().url(),
  title: z.string(),
  snippet: z.string().default(""),
  source: z.string().default("unknown"),
  publishedAt: z.string().optional()
});

export const SearchInputSchema = z.object({
  query: z.string().min(1),
  options: SearchOptionsSchema.optional()
});

export const SearchOutputSchema = z.object({
  results: z.array(SearchResultSchema)
});

export const LinkSchema = z.object({
  url: z.string().url(),
  text: z.string(),
  rel: z.string().optional(),
  isInternal: z.boolean()
});

export const FormFieldSchema = z.object({
  name: z.string().optional(),
  type: z.string().default("text"),
  required: z.boolean().default(false),
  placeholder: z.string().optional(),
  label: z.string().optional()
});

export const FormSchema = z.object({
  id: z.string(),
  action: z.string().optional(),
  method: z.string().default("get"),
  fields: z.array(FormFieldSchema)
});

export const ActionParamsSchemaSchema = z.object({
  type: z.string().default("object"),
  properties: z.record(z.any()).default({}),
  required: z.array(z.string()).default([])
});

export const WebActionSchema = z.object({
  id: z.string(),
  type: ActionTypeSchema,
  label: z.string(),
  selector: z.string(),
  paramsSchema: ActionParamsSchemaSchema
});

export const LLMPageSchema = z.object({
  id: z.string(),
  url: z.string().url(),
  canonicalUrl: z.string().url().optional(),
  title: z.string().default(""),
  fetchedAt: z.string(),
  contentHash: z.string().optional(),
  extractorVersion: z.string().default("v1"),
  mode: ModeSchema,
  source: z.enum(["static", "playwright"]),
  headings: z.array(z.string()),
  keyParagraphs: z.array(z.string()),
  links: z.array(LinkSchema),
  forms: z.array(FormSchema),
  actions: z.array(WebActionSchema),
  rawRef: z.string().optional()
});

export const OpenInputSchema = z.object({
  url: z.string().url(),
  mode: ModeSchema.default("compact"),
  use: UseSchema.default("auto"),
  session: z.string().optional()
});

export const OpenOutputSchema = z.object({
  page: LLMPageSchema
});

export const ActionsListInputSchema = z.object({
  url: z.string().url().optional(),
  pageId: z.string().optional(),
  session: z.string().optional()
}).refine((v) => Boolean(v.url || v.pageId), { message: "url or pageId is required" });

export const ActionsListOutputSchema = z.object({
  actions: z.array(WebActionSchema)
});

export const ActionOutcomeSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  diagnostics: z.record(z.any()).optional()
});

export const ActionsExecuteInputSchema = z.object({
  actionId: z.string(),
  params: z.record(z.any()).optional(),
  session: z.string().min(1),
  returnPage: z.boolean().default(false),
  mode: ModeSchema.default("compact")
});

export const ActionsExecuteOutputSchema = z.object({
  outcome: ActionOutcomeSchema,
  page: LLMPageSchema.optional()
});

export const SessionInfoSchema = z.object({
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  storageStatePath: z.string(),
  notes: z.string().optional(),
  headed: z.boolean().optional()
});

export const SessionCreateInputSchema = z.object({
  name: z.string().min(1),
  headed: z.boolean().default(false)
});

export const SessionSaveInputSchema = z.object({
  name: z.string().min(1)
});

export const SessionOutputSchema = z.object({
  session: SessionInfoSchema
});

export const CrawlOptionsSchema = z.object({
  maxPages: z.number().int().min(1).max(10000).default(100),
  maxDepth: z.number().int().min(0).max(10).default(2),
  mode: ModeSchema.default("compact"),
  allowDomains: z.array(z.string()).optional(),
  denyDomains: z.array(z.string()).optional(),
  respectRobots: z.boolean().default(true),
  perDomainDelayMs: z.number().int().min(0).default(500)
});

export const CrawlStartInputSchema = z.object({
  seedUrls: z.array(z.string().url()).min(1),
  options: CrawlOptionsSchema.optional()
});

export const CrawlStartOutputSchema = z.object({
  jobId: z.string()
});

export const CrawlQueueItemSchema = z.object({
  url: z.string().url(),
  depth: z.number().int().min(0),
  status: z.enum(["pending", "processing", "done", "failed"]),
  retries: z.number().int().min(0)
});

export const CrawlJobStatusSchema = z.object({
  id: z.string(),
  status: z.enum(["pending", "running", "finished", "failed"]),
  createdAt: z.string(),
  finishedAt: z.string().optional(),
  stats: z.object({
    queued: z.number().int().min(0),
    processing: z.number().int().min(0),
    done: z.number().int().min(0),
    failed: z.number().int().min(0)
  })
});

export const CrawlStatusInputSchema = z.object({
  jobId: z.string()
});

export const CrawlStatusOutputSchema = z.object({
  job: CrawlJobStatusSchema
});

export const CrawlNextInputSchema = z.object({
  jobId: z.string(),
  limit: z.number().int().min(1).max(100).default(10),
  mode: ModeSchema.default("compact")
});

export const CrawlNextOutputSchema = z.object({
  pages: z.array(LLMPageSchema)
});

export const StoreQueryInputSchema = z.object({
  text: z.string().min(1),
  limit: z.number().int().min(1).max(50).default(10)
});

export const StoredPageHitSchema = z.object({
  id: z.string(),
  url: z.string().url(),
  title: z.string(),
  snippet: z.string(),
  fetchedAt: z.string(),
  score: z.number()
});

export const StoreQueryOutputSchema = z.object({
  hits: z.array(StoredPageHitSchema)
});

export type SearchOptions = z.infer<typeof SearchOptionsSchema>;
export type SearchResult = z.infer<typeof SearchResultSchema>;
export type LLMPage = z.infer<typeof LLMPageSchema>;
export type WebAction = z.infer<typeof WebActionSchema>;
export type SessionInfo = z.infer<typeof SessionInfoSchema>;
export type ActionOutcome = z.infer<typeof ActionOutcomeSchema>;
export type CrawlOptions = z.infer<typeof CrawlOptionsSchema>;
export type CrawlJobStatus = z.infer<typeof CrawlJobStatusSchema>;
export type StoredPageHit = z.infer<typeof StoredPageHitSchema>;
