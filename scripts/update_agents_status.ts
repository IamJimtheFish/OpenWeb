import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { getStore } from "@webx/store";

const STATUS_HEADER = "STATUS (auto-updated, do not edit manually)";

function resolveAgentsPaths(): string[] {
  const candidates = ["AGENTS.md", "Agents.md"];
  const paths: string[] = [];
  for (const candidate of candidates) {
    const absolute = path.resolve(process.cwd(), candidate);
    if (fs.existsSync(absolute)) paths.push(absolute);
  }
  if (paths.length === 0) {
    throw new Error("Could not find AGENTS.md/Agents.md in current directory");
  }
  return paths;
}

function parseServicesArg(argv: string[]): string[] {
  const raw = argv.find((arg) => arg.startsWith("--services="));
  if (!raw) return [];
  return raw
    .split("=")[1]
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function gitCommit(): string {
  try {
    return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "unknown";
  }
}

function getLastSuccess(tool: "search" | "open" | "action" | "crawl"): string {
  return getStore().getMeta(`last_success_${tool}`) || "none";
}

export function updateAgentsStatus(services: string[]): void {
  const agentsPaths = resolveAgentsPaths();

  const store = getStore();
  const block = [
    STATUS_HEADER,
    `- last_run_utc: ${new Date().toISOString()}`,
    `- git_commit: ${gitCommit()}`,
    `- services: [${services.join(", ")}]`,
    `- db_schema_version: ${store.getSchemaVersion()}`,
    "- last_success:",
    `  - search: ${getLastSuccess("search")}`,
    `  - open: ${getLastSuccess("open")}`,
    `  - action: ${getLastSuccess("action")}`,
    `  - crawl: ${getLastSuccess("crawl")}`,
    ""
  ].join("\n");

  const escapedHeader = STATUS_HEADER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const agentsPath of agentsPaths) {
    const source = fs.readFileSync(agentsPath, "utf8");
    if (!source.includes(STATUS_HEADER)) {
      throw new Error(`STATUS block not found in ${path.basename(agentsPath)}`);
    }
    const updated = source.replace(new RegExp(`${escapedHeader}[\\s\\S]*$`, "m"), block);
    fs.writeFileSync(agentsPath, updated, "utf8");
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const services = parseServicesArg(process.argv.slice(2));
  updateAgentsStatus(services);
  console.log(`[agents] status updated (${services.length ? services.join(",") : "no services"})`);
}
