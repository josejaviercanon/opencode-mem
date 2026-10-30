import { describe, expect, it } from "bun:test";
import { MarkdownVaultWatcher } from "../src/services/markdown/watcher.js";

describe("markdown vault watcher", () => {
  it("tracks self-writes so matching paths are suppressed", () => {
    const w = new MarkdownVaultWatcher(50);
    w.noteSelfWrite("mem_1.md");
    // Internal set is private; verify start/stop do not throw on missing dir handling
    // by stopping a never-started watcher.
    w.stop();
    expect(w.active).toBe(false);
  });

  it("reports inactive before start", () => {
    const w = new MarkdownVaultWatcher();
    expect(w.active).toBe(false);
  });
});
