import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

const apiHandlersUrl = new URL("../src/services/api-handlers.js", import.meta.url).href;
const embeddingUrl = new URL("../src/services/embedding.js", import.meta.url).href;
const vectorUtilsUrl = new URL("../src/services/turso/vector-utils.js", import.meta.url).href;
const connectionManagerUrl = new URL("../src/services/turso/connection-manager.js", import.meta.url)
  .href;
const shardManagerUrl = new URL("../src/services/turso/shard-manager.js", import.meta.url).href;
const vectorSearchUrl = new URL("../src/services/turso/vector-search.js", import.meta.url).href;
const readyUrl = new URL("../src/services/turso/ready.js", import.meta.url).href;
const userPromptManagerUrl = new URL(
  "../src/services/user-prompt/user-prompt-manager.js",
  import.meta.url
).href;
const loggerUrl = new URL("../src/services/logger.js", import.meta.url).href;
const factoryUrl = new URL("../src/services/ai/ai-provider-factory.js", import.meta.url).href;
const providerConfigUrl = new URL("../src/services/ai/provider-config.js", import.meta.url).href;
const configUrl = new URL("../src/config.js", import.meta.url).href;
const opencodeProviderLoaderUrl = new URL(
  "../src/services/ai/opencode-provider-loader.js",
  import.meta.url
).href;
const profileLlmClientUrl = new URL("../src/services/ai/profile-llm-client.js", import.meta.url)
  .href;

function runScenario(opts: {
  config: Record<string, unknown>;
  scriptBody: string;
  opencodeTags?: string[];
  opencodeThrows?: string;
  externalCalled?: boolean;
}) {
  const dir = mkdtempSync(join(tmpdir(), "opencode-mem-tag-mig-oc-"));
  tempDirs.push(dir);
  const scriptPath = join(dir, "scenario.mjs");
  const script = `
import { mock } from "bun:test";

const updateVectorCalls = [];
const updateTagCalls = [];
const externalCalls = [];
const memories = [
  { id: "m1", content: "fix auth race in session store", tags: null },
];

mock.module(${JSON.stringify(embeddingUrl)}, () => ({
  embeddingService: {
    isWarmedUp: true,
    warmup: async () => {},
    embedWithTimeout: async () => new Float32Array([1, 2, 3]),
  },
}));

mock.module(${JSON.stringify(vectorUtilsUrl)}, () => ({
  formatTagsForEmbedding: (tags) => tags.join(","),
  parseSessionIdFromMetadata: () => null,
}));

mock.module(${JSON.stringify(connectionManagerUrl)}, () => ({
  tursoConnectionManager: {
    getConnection: async () => ({
      all: async () => memories,
      run: async (sql, params) => {
        updateTagCalls.push({ sql, params });
      },
      get: async () => ({ count: memories.length }),
    }),
    closeAll: async () => {},
  },
}));

mock.module(${JSON.stringify(shardManagerUrl)}, () => ({
  tursoShardManager: {
    async getAllShards() {
      return [{ id: 1, scope: "project", scopeHash: "h", shardIndex: 0, dbPath: "/tmp/shard.db" }];
    },
    async withScopeWriteLock(_scope, _hash, operation) {
      return operation();
    },
    async getWriteShard() {
      return { id: 1, scope: "project", scopeHash: "h", shardIndex: 0, dbPath: "/tmp/shard.db" };
    },
    async incrementVectorCount() {},
  },
}));

mock.module(${JSON.stringify(vectorSearchUrl)}, () => ({
  tursoVectorSearch: {
    updateVector: async (_db, id) => {
      updateVectorCalls.push(id);
    },
    insertVector: async () => {},
    listMemories: async () => [],
  },
}));

mock.module(${JSON.stringify(readyUrl)}, () => ({
  ensureTursoReady: async () => {},
}));

mock.module(${JSON.stringify(userPromptManagerUrl)}, () => ({
  userPromptManager: {},
}));

mock.module(${JSON.stringify(loggerUrl)}, () => ({
  log: () => {},
  safeLog: () => {},
  serializeError: (error) => ({ error: error instanceof Error ? error.message : String(error) }),
}));

mock.module(${JSON.stringify(configUrl)}, () => ({
  CONFIG: ${JSON.stringify(opts.config)},
}));

mock.module(${JSON.stringify(providerConfigUrl)}, () => ({
  buildMemoryProviderConfig: () => ({}),
}));

mock.module(${JSON.stringify(factoryUrl)}, () => ({
  AIProviderFactory: {
    createProvider() {
      return {
        async executeToolCall() {
          externalCalls.push(true);
          return { success: true, data: { tags: ["external", "fallback"] } };
        },
      };
    },
  },
}));

mock.module(${JSON.stringify(opencodeProviderLoaderUrl)}, () => ({
  loadOpencodeProvider: async () => ({
    generateStructuredOutput: async () => {
      ${
        opts.opencodeThrows
          ? `throw new Error(${JSON.stringify(opts.opencodeThrows)});`
          : `return { tags: ${JSON.stringify(opts.opencodeTags ?? ["auth", "session"])} };`
      }
    },
  }),
}));

mock.module(${JSON.stringify(profileLlmClientUrl)}, () => ({
  getOpenCodeClient: async () => ({}),
}));

const {
  handleRunTagMigrationBatch,
  handleGetTagMigrationProgress,
} = await import(${JSON.stringify(apiHandlersUrl)});

${opts.scriptBody}
`;
  writeFileSync(scriptPath, script, "utf-8");
  const result = Bun.spawnSync({
    cmd: [process.execPath, scriptPath],
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = Buffer.from(result.stdout).toString("utf8").trim();
  const stderr = Buffer.from(result.stderr).toString("utf8").trim();
  const jsonLine = stdout
    .split("\n")
    .reverse()
    .find((line) => line.trim().startsWith("{"));

  return {
    exitCode: result.exitCode,
    stdout,
    stderr,
    parsed: jsonLine ? JSON.parse(jsonLine) : null,
  };
}

describe("tag migration opencode provider (#442)", () => {
  it("uses opencodeProvider without requiring memoryModel/memoryApiUrl/memoryApiKey", () => {
    const result = runScenario({
      config: {
        opencodeProvider: "anthropic",
        opencodeModel: "claude-haiku-4-5-20251001",
        memoryProvider: "openai-chat",
      },
      opencodeTags: ["auth", "race"],
      scriptBody: `
const batch = await handleRunTagMigrationBatch(5);
const progress = await handleGetTagMigrationProgress();
console.log(JSON.stringify({
  batch,
  progress,
  updateVectorCalls,
  updateTagCalls,
  externalCalls,
}));
`,
    });

    expect(result.exitCode).toBe(0);
    expect(result.parsed).not.toBeNull();
    expect(result.parsed.batch.success).toBe(true);
    expect(result.parsed.batch.data.processed).toBe(1);
    expect(result.parsed.batch.data.errors).toBe(0);
    expect(result.parsed.updateTagCalls[0].params[0]).toBe("auth,race");
    expect(result.parsed.externalCalls).toEqual([]);
  });

  it("fails clearly when neither opencode nor external providers are configured", () => {
    const result = runScenario({
      config: { memoryProvider: "openai-chat" },
      scriptBody: `
const batch = await handleRunTagMigrationBatch(5);
console.log(JSON.stringify({ batch }));
`,
    });

    expect(result.exitCode).toBe(0);
    expect(result.parsed.batch.success).toBe(false);
    expect(result.parsed.batch.error).toContain("opencodeProvider");
  });

  it("falls back to external API when opencodeProvider fails", () => {
    const result = runScenario({
      config: {
        opencodeProvider: "anthropic",
        opencodeModel: "claude-haiku-4-5-20251001",
        memoryProvider: "openai-chat",
        memoryModel: "gpt-4o-mini",
        memoryApiUrl: "https://api.example.com/v1",
        memoryApiKey: "test-key",
      },
      opencodeThrows: "provider offline",
      scriptBody: `
const batch = await handleRunTagMigrationBatch(5);
console.log(JSON.stringify({ batch, updateTagCalls, externalCalls }));
`,
    });

    expect(result.exitCode).toBe(0);
    expect(result.parsed.batch.success).toBe(true);
    expect(result.parsed.batch.data.processed).toBe(1);
    expect(result.parsed.batch.data.errors).toBe(0);
    expect(result.parsed.externalCalls).toEqual([true]);
    expect(result.parsed.updateTagCalls[0].params[0]).toBe("external,fallback");
  });
});
