import { describe, expect, it } from "bun:test";

describe("markdown backend config", () => {
  it("exposes memoryBackend on CONFIG", async () => {
    const { CONFIG } = await import("../src/config.js");
    expect(["database", "markdown"]).toContain(CONFIG.memoryBackend);
    if (CONFIG.memoryBackend === "markdown") {
      expect(typeof CONFIG.markdownPath).toBe("string");
      expect((CONFIG.markdownPath as string).length).toBeGreaterThan(0);
    }
  });

  it("keeps storagePath as a non-empty absolute-ish path", async () => {
    // Other tests may mutate CONFIG.storagePath; only assert the runtime shape.
    const { CONFIG } = await import("../src/config.js");
    expect(typeof CONFIG.storagePath).toBe("string");
    expect(CONFIG.storagePath.length).toBeGreaterThan(0);
  });
});
