# OpenWeb

OpenWeb is a local TypeScript web-automation stack for LLM agents.

It provides:
- low-token web search and page extraction,
- Playwright-backed interaction when static fetch is not enough,
- crawling + SQLite-backed memory,
- MCP tools so Codex (and other MCP clients) can use it directly.

## Why Use It

- Faster web tasks: search/open/extract without manual browsing.
- Lower token cost: compact structured outputs instead of raw HTML.
- Real interactions: click/fill/submit via browser sessions when needed.
- Reusable memory: crawl once, query stored pages later.
- Portable interface: same tool surface via MCP and HTTP API.

## Crawler Improvements

OpenWeb crawler is tuned for high-signal, low-token domain crawling:
- deterministic queue dedupe per job (`job_id + normalized URL`)
- URL normalization (tracking params/fragments removed, canonicalized ordering)
- nuisance/non-HTML URL filtering before enqueue
- robots-aware crawling (Allow/Disallow + crawl-delay handling)
- sitemap seeding from `robots.txt` and `sitemap.xml`/sitemap indexes
- priority scoring for discovered links (depth/path/seed relevance)
- adaptive politeness delay based on observed domain latency
- unchanged-page skip (content hash check against latest stored page)

## Components

- API server: `packages/api`
- MCP server: `packages/mcp`
- Crawler worker: `packages/crawler`
- Core extraction: `packages/core`
- Browser automation: `packages/browser`
- Store (SQLite): `packages/store`
- Skill package: `SKILLS/webx`

## Prerequisites

- Node.js 20+
- `corepack` available
- Linux/WSL/macOS shell environment

## Install Dependencies

```bash
corepack pnpm install
```

## Install Into Codex

From repo root:

```bash
./scripts/install_codex_skill.sh --configure-mcp
```

What this does:
1. Links skill folder to `~/.codex/skills/openweb`
2. Adds MCP server entry `mcp_servers.openweb` to `~/.codex/config.toml`

## Start / Verify / Stop

Use the installed skill scripts:

```bash
~/.codex/skills/openweb/scripts/webx-up.sh
~/.codex/skills/openweb/scripts/webx-verify.sh
~/.codex/skills/openweb/scripts/webx-down.sh
```

## How It Works In Codex

When the skill is active, Codex should follow this pattern:
1. `webx.search` for discovery
2. `webx.open` with `{ use: "static", mode: "compact" }`
3. Escalate to Playwright only when needed
4. For interactions: `webx.actions.list` then `webx.actions.execute`
5. For repeated domains: `webx.crawl.start/status/next` and `webx.store.query`

### Crawl Options (high impact)

- `respectRobots` (default `true`)
- `perDomainDelayMs` (default `500`)
- `seedFromSitemaps` (default `true`)
- `maxSitemapUrls` (default `200`)
- `adaptiveDelay` (default `true`)

## Data Paths

- SQLite DB: `data/webx.sqlite`
- Artifacts: `data/artifacts/`
- Browser sessions: `data/sessions/`

## Reliability Guidelines

- Run dependency-using scripts from repo root (not random temp paths).
- Heredoc file writes (`cat > file <<'EOF'`) are expected to be silent on success.
- Avoid broad `pkill -f <pattern>` in the same command chain; prefer PID-file based process control.

## Validation

```bash
corepack pnpm check
corepack pnpm test
```
