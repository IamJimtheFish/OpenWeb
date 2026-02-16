import { getCrawlerService } from "./index.js";

const crawler = getCrawlerService();

async function tick(): Promise<void> {
  try {
    await crawler.processActiveJobsOnce();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Worker stays alive; failures are logged for visibility.
    console.error(`[crawler] tick failure: ${message}`);
  }
}

export function startCrawlerWorker(intervalMs = Number(process.env.CRAWLER_POLL_MS || 1000)): NodeJS.Timeout {
  const timer = setInterval(() => {
    void tick();
  }, intervalMs);
  void tick();
  console.log(`[crawler] worker started (poll=${intervalMs}ms)`);
  return timer;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startCrawlerWorker();
}
