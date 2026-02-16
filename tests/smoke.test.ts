import { describe, expect, it } from "vitest";
import { OpenInputSchema, SearchInputSchema } from "@webx/types";

describe("schema smoke tests", () => {
  it("validates search input", () => {
    const parsed = SearchInputSchema.parse({ query: "web automation" });
    expect(parsed.query).toBe("web automation");
  });

  it("applies default open mode", () => {
    const parsed = OpenInputSchema.parse({ url: "https://example.com" });
    expect(parsed.mode).toBe("compact");
  });
});
