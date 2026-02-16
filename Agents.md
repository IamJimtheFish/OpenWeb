# AGENTS.md — OpenWeb (TypeScript, SQLite, Playwright, SearXNG, MCP, Codex Skill)

This repo builds a local TypeScript system that lets an LLM use the internet like a human, but with low-token structured outputs. It provides token-efficient web search + open + bloat reduction, a high-effectiveness crawler, and Playwright/Chromium sessions as a safeguard for JS/login/actions. It exposes everything through MCP tools (portable), with a Codex Skill wrapper for orchestration.

Non-goals (for now)
- No web UI. CLI + API + MCP only.
- No Postgres. Use SQLite.
- No provider APIs (email is via web automation only, and is treated as just another website).

Primary outcomes
1) Low-token web interaction primitives:
   - Search (SearXNG)
   - Open page → reduce bloat → compact structured JSON
   - List actions (forms/buttons/links) → execute actions via Playwright
   - Optional crawl to build a compact “domain memory” corpus

2) Human-like agent capability for arbitrary tasks:
   - Navigate sites, login, fill forms, submit, search within sites
   - Shopping, reservations, admin consoles, dashboards, documentation, forums
   - Any web workflows, not limited to any single domain (email is not special)

3) Portability and maintainability:
   - MCP server is the primary interface and should work for Codex and other LLM clients.
   - Codex Skill teaches best-practice use of the MCP tools.
   - TypeScript + strict types, types stored centrally, Zod validation on all boundaries.

Repo layout (target)
- packages/
  - types/                  # single source of truth: TS types + Zod schemas
  - core/                   # extraction/normalization + bloat removal + action discovery
  - store/                  # SQLite persistence + migrations
  - crawler/                # frontier/queue/dedupe/politeness/robots/sitemaps
  - browser/                # Playwright sessions + action executor
  - searxng/                # SearXNG client
  - api/                    # HTTP API mirroring MCP tools
  - mcp/                    # MCP server exposing tools (primary interface)
  - cli/                    # CLI helpers (dev convenience)
- scripts/
  - update_agents_status.ts
  - migrate.ts
- SKILLS/
  - webx/
    - SKILL.md             # Codex skill instructions (uses MCP tools)
- AGENTS.md                # this file

Runtime storage
- SQLite DB: `./data/webx.sqlite`
- Artifacts/caches: `./data/artifacts/*`
- Playwright sessions: `./data/sessions/<sessionName>/*` (storageState json + metadata)
- Optional HTML snapshots: stored as file refs only (never inline by default)

Core rules
- Prefer deterministic extraction (no LLM-in-the-loop extraction).
- Low token output is a hard requirement: compact mode by default.
- Playwright is a safeguard: use static fetch first; escalate only when needed.
- All tool/API inputs & outputs are validated against Zod schemas from `packages/types`.

SQLite schema (minimum)
- pages: id, url, canonical_url, title, fetched_at, content_hash, extractor_version, mode, source, page_json
- links: from_page_id, to_url, text, rel, is_internal
- crawl_jobs: id, status, seed_url_json, created_at, finished_at, options_json
- crawl_queue: id, job_id, url, depth, priority, next_fetch_at, domain, status, retries, last_error
- sessions: name, created_at, updated_at, storage_state_path, notes
- actions_log: id, session_name, url, action_json, result_json, created_at

Crawler requirements (super-effective, low token)
- Politeness: per-domain concurrency, delay, backoff.
- Dedupe: canonical URL + content hash; skip unchanged.
- Frontier: priority queue + depth limit + allowlist/denylist.
- robots.txt: configurable; default “respect”.
- Sitemap support: optional, used as hints.
- Output modes:
  - compact (default): headings, key paragraphs, key links, actions, forms
  - full: more content blocks
  - rawRef: optional pointer to saved HTML snapshot (not inline)
- Strong boilerplate removal:
  - remove cookie banners, nav, footer, repetitive sidebars, “related” widgets
  - readability-like main content extraction
  - stable block IDs to enable diffs

Playwright sessions (safeguard + actions)
- Session lifecycle:
  - create session (name)
  - open URL in session
  - persist storage state (cookies/localStorage) as local file
- Escalate to Playwright when:
  - static fetch is blocked/insufficient
  - JS rendering required
  - login required
  - user requested interaction (click/fill/submit)
- Support headless by default; allow headed mode for manual login/2FA steps.
- user requested actions (click/fill/submit) or needs screenshots

Action model
- webx.actions.list returns stable action IDs with:
  - type: click | fill | select | submit | navigate
  - label: human readable
  - selector: strict CSS and/or role-based locator strategy
  - paramsSchema: input requirements (Zod-derived)
- webx.actions.execute runs the action via Playwright and returns:
  - outcome (success/failure + diagnostics)
  - optional updated LLMPage (compact by default)
- Never guess selectors inside the agent; always request actions.list first.

Search (SearXNG)
- Must work with `SEARXNG_URL` (running instance).
- Return: url, title, snippet, source/engine, optional published date if available.

MCP tool surface (primary, portable)
All tool I/O must validate via Zod schemas from `packages/types`.

1) webx.search
Input: { query: string, options?: SearchOptions }
Output: { results: SearchResult[] }

2) webx.open
Input: { url: string, mode?: "compact"|"full", use?: "auto"|"static"|"playwright", session?: string }
Output: { page: LLMPage }

3) webx.actions.list
Input: { url?: string, pageId?: string, session?: string }
Output: { actions: WebAction[] }

4) webx.actions.execute
Input: { actionId: string, params?: object, session: string, returnPage?: boolean, mode?: "compact"|"full" }
Output: { outcome: ActionOutcome, page?: LLMPage }

5) webx.session.create
Input: { name: string, headed?: boolean }
Output: { session: SessionInfo }

6) webx.session.save
Input: { name: string }
Output: { session: SessionInfo }

7) webx.crawl.start
Input: { seedUrls: string[], options?: CrawlOptions }
Output: { jobId: string }

8) webx.crawl.status
Input: { jobId: string }
Output: { job: CrawlJobStatus }

9) webx.crawl.next
Input: { jobId: string, limit?: number, mode?: "compact"|"full" }
Output: { pages: LLMPage[] }

10) webx.store.query
Input: { text: string, limit?: number }
Output: { hits: StoredPageHit[] }

General automation note
- “Email” is not a special subsystem. If the agent needs to use webmail, it is just another site:
  - use webx.session.create + webx.open(use=playwright) + webx.actions.* to interact with it.

Codex Skill (must exist)
Create: `SKILLS/webx/SKILL.md` that instructs Codex to use the MCP tools above.
Codex rules:
- Use webx.search for discovery, then webx.open(mode=compact,use=static) first.
- Escalate to Playwright only when needed.
- For interaction: always actions.list then actions.execute.
- Keep outputs minimal: compact mode; open fewer pages but deeper.
- When summarizing information/news, list source URLs used.
- Avoid irreversible actions (checkout/payment/sending) unless explicitly requested.

Web automation reliability notes (cart flows)
- Do not infer product URLs from screenshot/product-name text.
- For each requested item, resolve product pages via site search using stable identifiers (model/SKU/code) first.
- Extract stable product identifiers from page actions/network patterns (e.g. `product_id`, variant ID) and add items via the site's add-to-cart endpoint/form with explicit quantity.
- Use one persistent browser/session context for all additions, then open the cart page.
- For automation scripts that use project dependencies, execute from repo root (`/home/tomas/webx`) and avoid `/tmp` entrypoints to prevent module resolution failures.
- Before declaring done, verify cart rows match requested model/SKU codes and quantities.

Automation execution reliability notes (general)
- Run scripts that require local dependencies (e.g. Playwright) from the project tree. Avoid running Node entrypoints from arbitrary temp directories unless module paths are intentionally configured.
- A heredoc file-write command (e.g. `cat > file <<'EOF' ...`) normally prints no output; treat success/failure by exit code, not by stdout.
- Do not use broad `pkill -f <pattern>` in the same shell command that may contain that pattern, because it can terminate the running command itself. Prefer PID-file based lifecycle management or run kill operations in a separate command.

Build/Run
- Node.js + pnpm.
- `pnpm i`
- `pnpm dev` starts API + crawler worker + MCP server.
- `pnpm test` and `pnpm check` must pass.

Autoupdate AGENTS.md (required)
Implement `scripts/update_agents_status.ts` that updates only the STATUS block below and is called at:
- end of `pnpm dev` startup (best-effort)
- end of `./run` (if present)
- after `pnpm test` in CI (only if tests pass)

STATUS (auto-updated, do not edit manually)
- last_run_utc: 2026-02-16T19:22:55.599Z
- git_commit: unknown
- services: [api, crawler, mcp]
- db_schema_version: 1
- last_success:
  - search: none
  - open: 2026-02-16T19:01:27.897Z
  - action: none
  - crawl: none
