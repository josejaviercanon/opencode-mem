import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const cleanupServiceUrl = new URL("../src/services/cleanup-service.js", import.meta.url).href;
const configUrl = new URL("../src/config.js", import.meta.url).href;
const loggerUrl = new URL("../src/services/logger.js", import.meta.url).href;
const readyUrl = new URL("../src/services/turso/ready.js", import.meta.url).href;
const shardManagerUrl = new URL("../src/services/turso/shard-manager.js", import.meta.url).href;
const vectorSearchUrl = new URL("../src/services/turso/vector-search.js", import.meta.url).href;
const connectionManagerUrl = new URL("../src/services/turso/connection-manager.js", import.meta.url)
  .href;
const promptManagerUrl = new URL(
  "../src/services/user-prompt/user-prompt-manager.js",
  import.meta.url
).href;
const aiProviderFactoryUrl = new URL("../src/services/ai/ai-provider-factory.js", import.meta.url)
  .href;

function runCleanupScenario() {
  const dir = mkdtempSync(join(tmpdir(), "opencode-mem-cleanup-ai-"));
  tempDirs.push(dir);
  const scriptPath = join(dir, "scenario.mjs");

  const script = `
import { mock } from "bun:test";

let cleanupExpiredCalls = 0;

mock.module(${JSON.stringify(configUrl)}, () => ({
  CONFIG: {
    autoCleanupEnabled: true,
    autoCleanupRetentionDays: 30,
    storagePath: ${JSON.stringify(dir)},
  },
}));

mock.module(${JSON.stringify(loggerUrl)}, () => ({
  log: () => {},
  safeLog: () => {},
  serializeError: (error) => ({ error: String(error) }),
}));

mock.module(${JSON.stringify(readyUrl)}, () => ({
  ensureTursoReady: async () => {},
}));

mock.module(${JSON.stringify(shardManagerUrl)}, () => ({
  tursoShardManager: {
    getAllShards: async () => [],
    decrementVectorCount: async () => {},
  },
}));

mock.module(${JSON.stringify(vectorSearchUrl)}, () => ({
  tursoVectorSearch: {
    deleteVector: async () => {},
  },
}));

mock.module(${JSON.stringify(connectionManagerUrl)}, () => ({
  tursoConnectionManager: {
    getConnection: async () => ({
      all: async () => [],
    }),
  },
}));

mock.module(${JSON.stringify(promptManagerUrl)}, () => ({
  userPromptManager: {
    deleteOldPrompts: async () => ({ deleted: 0, linkedMemoryIds: [] }),
    vacuum: async () => {},
  },
}));

mock.module(${JSON.stringify(aiProviderFactoryUrl)}, () => ({
  AIProviderFactory: {
    cleanupExpiredSessions: async () => {
      cleanupExpiredCalls += 1;
      return 7;
    },
  },
}));

const { cleanupService } = await import(${JSON.stringify(cleanupServiceUrl)});
const result = await cleanupService.runCleanup();
console.log(JSON.stringify({ result, cleanupExpiredCalls }));
`;

  writeFileSync(scriptPath, script);

  const result = Bun.spawnSync({
    cmd: [process.execPath, scriptPath],
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = Buffer.from(result.stdout).toString("utf8").trim();
  const stderr = Buffer.from(result.stderr).toString("utf8").trim();

  return {
    exitCode: result.exitCode,
    stdout,
    stderr,
    parsed: stdout ? JSON.parse(stdout) : null,
  };
}

describe("cleanup AI sessions", () => {
  it("calls cleanupExpiredSessions during runCleanup", () => {
    const result = runCleanupScenario();
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.parsed.cleanupExpiredCalls).toBe(1);
    expect(result.parsed.result.aiSessionsDeleted).toBe(7);
  });
});
