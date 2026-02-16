import { spawn, type ChildProcess } from "node:child_process";
import { updateAgentsStatus } from "./update_agents_status.js";

const children: ChildProcess[] = [];
let shuttingDown = false;

function startService(name: string, script: string, keepStdin = false): ChildProcess {
  const child = spawn("corepack", ["pnpm", script], {
    stdio: [keepStdin ? "pipe" : "ignore", "inherit", "inherit"],
    env: process.env
  });

  child.on("exit", (code, signal) => {
    if (!shuttingDown) {
      console.error(`[dev] ${name} exited (code=${code ?? "null"}, signal=${signal ?? "null"})`);
      void shutdown(code ?? 1);
    }
  });

  children.push(child);
  return child;
}

async function shutdown(exitCode = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }

  process.exit(exitCode);
}

async function main(): Promise<void> {
  startService("api", "api");
  startService("crawler", "worker");
  startService("mcp", "mcp", true);

  setTimeout(() => {
    try {
      updateAgentsStatus(["api", "crawler", "mcp"]);
      console.log("[dev] services started and status updated");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[dev] failed to update AGENTS status: ${message}`);
    }
  }, 1200);

  process.on("SIGINT", () => {
    void shutdown(0);
  });

  process.on("SIGTERM", () => {
    void shutdown(0);
  });
}

void main();
