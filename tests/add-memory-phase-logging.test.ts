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

const clientUrl = new URL("../src/services/client.js", import.meta.url).href;
const configUrl = new URL("../src/config.js", import.meta.url).href;
const loggerUrl = new URL("../src/services/logger.js", import.meta.url).href;
const embeddingUrl = new URL("../src/services/embedding.js", import.meta.url).href;
const readyUrl = new URL("../src/services/turso/ready.js", import.meta.url).href;
const shardManagerUrl = new URL("../src/services/turso/shard-manager.js", import.meta.url).href;
const vectorUtilsUrl = new URL("../src/services/turso/vector-utils.js", import.meta.url).href;
const connectionManagerUrl = new URL("../src/services/turso/connection-manager.js", import.meta.url)
  .href;
const vectorSearchUrl = new URL("../src/services/turso/vector-search.js", import.meta.url).href;

function runAddMemoryPhaseScenario() {
  const dir = mkdtempSync(join(tmpdir(), "opencode-mem-add-memory-phase-"));
  tempDirs.push(dir);
  const scriptPath = join(dir, "scenario.mjs");

  const script = `
import { mock } from "bun:test";

const logs = [];

mock.module(${JSON.stringify(configUrl)}, () => ({
  CONFIG: { storagePath: ${JSON.stringify(dir)} },
}));

mock.module(${JSON.stringify(loggerUrl)}, () => ({
  log: (message, data) => logs.push({ message, data }),
  safeLog: (message, data) => logs.push({ message, data }),
  serializeError: (error) => ({
    error: error instanceof Error ? error.message : String(error),
    name: error instanceof Error ? error.name : undefined,
    stack: error instanceof Error ? error.stack : undefined,
  }),
}));

mock.module(${JSON.stringify(readyUrl)}, () => ({
  ensureTursoReady: async () => {},
}));

mock.module(${JSON.stringify(embeddingUrl)}, () => ({
  embeddingService: {
    embedWithTimeout: async () => {
      throw new Error("Timeout after 30000ms");
    },
  },
}));

mock.module(${JSON.stringify(vectorUtilsUrl)}, () => ({
  formatTagsForEmbedding: (tags) => tags.join(" "),
}));

mock.module(${JSON.stringify(shardManagerUrl)}, () => ({
  tursoShardManager: {
    withScopeWriteLock: async (_s, _h, fn) => fn(),
    getWriteShard: async () => ({ id: "shard-1", dbPath: "/tmp/x.db" }),
    incrementVectorCount: async () => {},
  },
}));

mock.module(${JSON.stringify(connectionManagerUrl)}, () => ({
  tursoConnectionManager: { getConnection: async () => ({}) },
}));

mock.module(${JSON.stringify(vectorSearchUrl)}, () => ({
  tursoVectorSearch: { insertVector: async () => {} },
}));

const { memoryClient } = await import(${JSON.stringify(clientUrl)});
const result = await memoryClient.addMemory("hello", "opencode_project_test");
console.log(JSON.stringify({ result, logs }));
`;

  writeFileSync(scriptPath, script);

  const result = Bun.spawnSync({
    cmd: [process.execPath, scriptPath],
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = Buffer.from(result.stdout).toString("utf8").trim();
  return {
    exitCode: result.exitCode,
    stderr: Buffer.from(result.stderr).toString("utf8").trim(),
    parsed: stdout ? JSON.parse(stdout) : null,
  };
}

describe("addMemory phase logging", () => {
  it("logs embed phase with structured error fields", () => {
    const result = runAddMemoryPhaseScenario();
    expect(result.exitCode).toBe(0);
    expect(result.parsed.result.success).toBe(false);
    const entry = result.parsed.logs.find(
      (l: { message: string }) => l.message === "addMemory: error"
    );
    expect(entry).toBeTruthy();
    expect(entry.data.phase).toBe("embed");
    expect(entry.data.error).toBe("Timeout after 30000ms");
    expect(entry.data.name).toBe("Error");
    expect(entry.data.stack).toContain("Timeout after 30000ms");
  });
});
