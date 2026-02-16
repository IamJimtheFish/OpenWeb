import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@webx/types": path.resolve(__dirname, "packages/types/src/index.ts"),
      "@webx/core": path.resolve(__dirname, "packages/core/src/index.ts"),
      "@webx/store": path.resolve(__dirname, "packages/store/src/index.ts"),
      "@webx/searxng": path.resolve(__dirname, "packages/searxng/src/index.ts"),
      "@webx/browser": path.resolve(__dirname, "packages/browser/src/index.ts"),
      "@webx/crawler": path.resolve(__dirname, "packages/crawler/src/index.ts"),
      "@webx/api": path.resolve(__dirname, "packages/api/src/index.ts"),
      "@webx/mcp": path.resolve(__dirname, "packages/mcp/src/index.ts"),
      "@webx/cli": path.resolve(__dirname, "packages/cli/src/index.ts")
    }
  },
  test: {
    include: ["tests/**/*.test.ts"]
  }
});
