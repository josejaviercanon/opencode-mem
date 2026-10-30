import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "opencode-mem-profile-empty-"));
let result: any;

afterAll(() => rmSync(directory, { recursive: true, force: true }));

beforeAll(() => {
  // Isolate module mocks from the suite. Drive the real shared plugin with
  // maxMemories: 0 so project listing is empty, while injectProfile stays on.
  const child = Bun.spawnSync([
    process.execPath,
    fileURLToPath(new URL("./fixtures/profile-inject-empty-memories.mjs", import.meta.url)),
    directory,
  ]);
  expect(child.exitCode).toBe(0);
  expect(child.stderr.toString()).toBe("");
  result = JSON.parse(child.stdout.toString().trim());
});

describe("profile injection with empty project memories", () => {
  it("still formats context when chatMessage.maxMemories is 0", () => {
    expect(result.listLimit).toBe(0);
    expect(result.formatCalls).toHaveLength(2);
    expect(result.formatCalls.every((call: any) => call.resultCount === 0)).toBe(true);
    expect(
      result.formatCalls.every((call: any) => call.userId === "fixture-user@example.com")
    ).toBe(true);
  });

  it("injects a profile-only memory context via memoryContext.load", () => {
    expect(result.loaded).toContain("<user_profile>");
    expect(result.loaded).toContain("fixture-user@example.com");
    expect(result.loaded).toContain("<memory_context>");
    expect(result.loaded).not.toContain("<project_knowledge>");
  });

  it("injects the same profile block on the V1 chat.message path", () => {
    expect(result.v1Parts).toHaveLength(2);
    expect(result.v1Parts[0].synthetic).toBe(true);
    expect(result.v1Parts[0].text).toBe(result.loaded);
  });
});
