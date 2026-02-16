---
name: openweb
description: >
  Use the local OpenWeb stack in /home/tomas/webx to do low-token web tasks through
  MCP tools: search, open pages, list/execute actions, manage browser sessions, crawl
  domains, and query stored pages. Use for browsing workflows, doc/news summarization,
  and authenticated site interactions with explicit confirmation before risky actions.
---

# OpenWeb

## When To Use
- User asks to browse/search/extract from websites.
- User needs interactive web actions (click/fill/submit).
- User wants repeatable crawl + store/query workflows.

## Startup
1. Start services: `scripts/webx-up.sh`.
2. Verify stack: `scripts/webx-verify.sh`.
3. Stop services when done: `scripts/webx-down.sh`.

## Core MCP Workflow
1. Discovery first: `webx.search`.
2. Open with static compact mode first: `webx.open` with `{ use: "static", mode: "compact" }`.
3. Escalate only when needed: `webx.open` with `{ use: "playwright", session: "..." }`.
4. For interaction, always:
   - `webx.actions.list`
   - then `webx.actions.execute` using returned `actionId`.
5. For repeated domains:
   - `webx.crawl.start`
   - `webx.crawl.status`
   - `webx.crawl.next`
   - `webx.store.query`.

## Safety Rules
- Require explicit user approval before irreversible actions:
  - sending/posting,
  - account changes,
  - purchases/payments,
  - bank operations.
- Never invent action IDs/selectors. Always list actions first.
- Never request or echo plaintext passwords in chat logs.

## Output Discipline
- Prefer compact mode.
- Open fewer pages, go deeper on the best ones.
- Include source URLs in summaries.

## Reliability Notes (Cart Automation)
- For e-shop cart tasks, do not guess SEO product URLs from names/screenshots.
- Resolve products by stable identifiers (model/SKU/code) through the site's search/listing flow first.
- Extract stable product identifiers from page actions/requests (e.g. `product_id`, variant ID), then add via the site's add-to-cart endpoint/form with explicit quantity.
- Keep one Playwright browser context/session for all additions, then open the cart route/page.
- Run local helper scripts from the project directory (`/home/tomas/webx`), not `/tmp`, so Node module resolution (e.g. `playwright`) works.
- Validate cart by matching requested model/SKU codes and quantities before reporting completion.

## Reliability Notes (Automation Execution)
- Run dependency-using scripts from the project directory (or set `NODE_PATH` intentionally); avoid launching Node entrypoints from arbitrary temp paths.
- Treat heredoc file creation commands (e.g. `cat > file <<'EOF' ...`) as write-only operations; `(no output)` is expected success unless exit code is non-zero.
- Avoid broad kill patterns in the same shell command that started a process (e.g. `pkill -f <script>`), because they can match the current command line. Prefer PID-based shutdown (`echo $! > pidfile`, then `kill "$(cat pidfile)"`) or run cleanup in a separate command.
