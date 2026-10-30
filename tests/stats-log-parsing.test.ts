import { describe, expect, it } from "bun:test";
import { classifyLogMessage, parseLogLine } from "../src/services/stats-service.js";

describe("stats log parsing", () => {
  it("parses counter signatures", () => {
    const fixtures = [
      ['Auto-capture memory persisted: {"id":"memory-1"}', "captures"],
      ['Auto-capture skipped: {"reason":"short"}', "captureSkipped"],
      ['profile inject: {"prefs":[]}', "profileInjections"],
      ['Compaction memory injected: {"count":1}', "compactionInjections"],
    ] as const;

    for (const [content, counter] of fixtures) {
      const parsed = parseLogLine(`[2026-10-16T19:18:33.096+11:00] ${content}`);
      expect(parsed).not.toBeNull();
      expect(classifyLogMessage(parsed!.message)).toEqual({ counter });
    }
  });

  it("classifies the known structured error signatures", () => {
    const fixtures = [
      [
        `[2026-10-16T19:18:33.096+11:00] Turso ready gate failed: {"error":"Error: failed to open database /home/x/.opencode-mem/data/user-profiles.db: I/O error: short read on WAL frame at offset 32: expected 4096 bytes, got 0"}`,
        "Turso ready gate failed",
      ],
      [
        `[2026-10-13T00:32:31.331+11:00] Failed to load skills for OpenCode registration: {"error":"TypeError: The database connection is not open"}`,
        "Failed to load skills for OpenCode registration",
      ],
      [
        `[2026-10-16T19:18:46.118+11:00] listMemories: error: {"error":"failed to open database ... short read on WAL frame"}`,
        "listMemories",
      ],
      [
        `[2026-10-16T19:20:00.000+11:00] Auto-capture final error after 3 attempts: {"error":"timeout"}`,
        "Auto-capture final error",
      ],
      [
        `[2026-10-16T19:21:00.000+11:00] Compaction handler error: {"error":"boom"}`,
        "Compaction handler error",
      ],
      [
        `[2026-10-16T19:22:00.000+11:00] Idle processing error: {"error":"boom"}`,
        "Idle processing error",
      ],
      [`[2026-10-16T19:23:00.000+11:00] chat.message: ERROR: {"error":"boom"}`, "chat.message"],
    ] as const;

    for (const [line, errorBucket] of fixtures) {
      const parsed = parseLogLine(line);
      expect(parsed).not.toBeNull();
      expect(classifyLogMessage(parsed!.message)).toEqual({ errorBucket });
    }
  });

  it("ignores separators and malformed lines and splits payload at the structured delimiter", () => {
    expect(parseLogLine("\n--- Session started: 2026-10-18T12:00:00.000+00:00 ---")).toBeNull();
    expect(parseLogLine("not a timestamp: Auto-capture memory persisted")).toBeNull();
    expect(parseLogLine("[2026-99-99T19:18:33.096+11:00] Auto-capture skipped")).toBeNull();

    const parsed = parseLogLine(
      `[2026-10-16T19:18:33.096+11:00] request: error: {"detail":"url: https://example.test/a"}`
    );
    expect(parsed).toEqual({
      date: "2026-10-16",
      message: "request: error",
      payload: `{"detail":"url: https://example.test/a"}`,
    });
    expect(classifyLogMessage(parsed!.message)).toEqual({ errorBucket: "request" });
  });
});
