import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

describe("handleStats health data", () => {
  let baseDir: string | undefined;
  let logDir: string | undefined;

  afterEach(async () => {
    await cleanupTursoTestDirectory(baseDir);
    if (logDir) rmSync(logDir, { recursive: true, force: true });
    baseDir = undefined;
    logDir = undefined;
  });

  it("aggregates shards and returns zero-filled daily log counters", async () => {
    baseDir = mkdtempSync(join(tmpdir(), "turso-stats-db-"));
    logDir = mkdtempSync(join(tmpdir(), "turso-stats-logs-"));

    const { CONFIG } = await import("../src/config.js");
    CONFIG.storagePath = baseDir;
    CONFIG.embeddingDimensions = 768;

    const { closeTursoAndInvalidateCaches } = await import("../src/services/turso/lifecycle.js");
    await closeTursoAndInvalidateCaches();

    const { tursoShardManager } = await import("../src/services/turso/shard-manager.js");
    const { tursoConnectionManager } = await import("../src/services/turso/connection-manager.js");
    const { tursoVectorSearch } = await import("../src/services/turso/vector-search.js");

    const vector = new Float32Array(768);
    vector[0] = 1;
    const userHash = "aaaaaaaaaaaaaaaa";
    const projectHash = "bbbbbbbbbbbbbbbb";
    const userShard = await tursoShardManager.createShard("user", userHash, 0);
    const projectShard = await tursoShardManager.createShard("project", projectHash, 0);
    const userDb = await tursoConnectionManager.getConnection(userShard.dbPath);
    const projectDb = await tursoConnectionManager.getConnection(projectShard.dbPath);
    const firstCreatedAt = Date.UTC(2026, 9, 12);
    const newestCreatedAt = Date.UTC(2026, 9, 16);

    const memory = (id: string, createdAt: number, containerTag: string, tags: string) => ({
      id,
      content: `memory ${id}`,
      vector,
      containerTag,
      tags,
      type: "context",
      createdAt,
      updatedAt: createdAt,
    });
    await tursoVectorSearch.insertVector(
      userDb,
      memory("user-1", firstCreatedAt, `opencode_user_${userHash}`, "shared-tag")
    );
    await tursoVectorSearch.insertVector(
      userDb,
      memory("user-2", newestCreatedAt, `opencode_user_${userHash}`, "shared-tag")
    );
    await tursoVectorSearch.insertVector(
      projectDb,
      memory("project-1", newestCreatedAt, `opencode_project_${projectHash}`, "project-tag")
    );

    const now = new Date(2026, 9, 18, 12, 0, 0);
    const day = (offset: number) => {
      const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      date.setDate(date.getDate() - offset);
      const pad = (value: number) => String(value).padStart(2, "0");
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    };
    const timestamp = (date: string, hour: string) => `[${date}T${hour}+00:00]`;
    writeFileSync(
      join(logDir, "opencode-mem-2026-10-01.log"),
      [
        `${timestamp(day(1), "10:00:00.000")} Auto-capture memory persisted: {"id":"1"}`,
        `${timestamp(day(1), "10:01:00.000")} Auto-capture skipped: {"reason":"short"}`,
        `${timestamp(day(1), "10:02:00.000")} listMemories: error: {"error":"fixture"}`,
      ].join("\n")
    );
    writeFileSync(
      join(logDir, "opencode-mem.log.old"),
      `${timestamp(day(3), "11:00:00.000")} Compaction memory injected: {"count":1}\n`
    );
    writeFileSync(
      join(logDir, "opencode-mem.log"),
      `${timestamp(day(4), "09:00:00.000")} profile inject: {"prefs":[]}\n`
    );

    const { handleStats } = await import("../src/services/api-handlers.js");
    const result = await handleStats({ logDir, now });
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data?.total).toBe(3);
    expect(result.data?.byScope).toEqual({ user: 2, project: 1 });
    expect(result.data?.byType).toEqual({ context: 3 });
    expect(result.data?.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.data?.profile).toEqual({ exists: false });

    const userStats = result.data?.shards.find((shard) => shard.scope === "user");
    const projectStats = result.data?.shards.find((shard) => shard.scope === "project");
    expect(result.data?.shards).toHaveLength(2);
    expect(userStats).toMatchObject({
      scope: "user",
      fileName: "user_aaaaaaaaaaaaaaaa_shard_0.db",
      fileExists: true,
      registeredVectorCount: 2,
      memoryCount: 2,
      oldestCreatedAt: new Date(firstCreatedAt).toISOString(),
      newestCreatedAt: new Date(newestCreatedAt).toISOString(),
      duplicateTagCount: 1,
    });
    expect(projectStats).toMatchObject({
      scope: "project",
      fileExists: true,
      registeredVectorCount: 1,
      memoryCount: 1,
      oldestCreatedAt: new Date(newestCreatedAt).toISOString(),
      newestCreatedAt: new Date(newestCreatedAt).toISOString(),
      duplicateTagCount: 0,
    });

    const daily = result.data?.daily;
    expect(daily).toHaveLength(14);
    expect(daily?.map((item) => item.date)).toEqual(
      Array.from({ length: 14 }, (_, i) => day(13 - i))
    );
    expect(daily?.[0]).toMatchObject({
      captures: 0,
      captureSkipped: 0,
      profileInjections: 0,
      compactionInjections: 0,
      errors: {},
    });
    expect(daily?.find((item) => item.date === day(1))).toMatchObject({
      captures: 1,
      captureSkipped: 1,
      errors: { listMemories: 1 },
    });
    expect(daily?.find((item) => item.date === day(3))?.compactionInjections).toBe(1);
    expect(daily?.find((item) => item.date === day(4))?.profileInjections).toBe(1);
    expect(result.data?.dailyError).toBeUndefined();
    // Windows CI needs >5s for two shard creations, three vector inserts, and
    // the full stats walk; the default 5s per-test timeout races afterEach
    // cleanup against the in-flight walk. Same budget as plugin-bundle-boundary.
  }, 30_000);

  it("probe mode returns success without opening shards or scanning logs", async () => {
    const { handleStats } = await import("../src/services/api-handlers.js");
    const result = await handleStats({ probe: true });
    expect(result).toEqual({ success: true });
    expect(result.data).toBeUndefined();
  });

  it("excludes a shard from totals when a later query fails mid-walk", async () => {
    const shardDir = mkdtempSync(join(tmpdir(), "turso-stats-partial-"));
    const dbPath = join(shardDir, "user_aaaaaaaaaaaaaaaa_shard_0.db");
    writeFileSync(dbPath, "");

    const { collectShardStats } = await import("../src/services/stats-service.js");
    const { tursoConnectionManager } = await import("../src/services/turso/connection-manager.js");
    const original = tursoConnectionManager.getConnection.bind(tursoConnectionManager);

    tursoConnectionManager.getConnection = (async () => ({
      all: async (sql: string) => {
        if (sql.includes("GROUP BY container_tag")) {
          return [{ container_tag: "opencode_user_aaaaaaaaaaaaaaaa", type: "context", c: 4 }];
        }
        throw new Error("duplicate query failed");
      },
      get: async () => ({ c: 4, mn: Date.UTC(2026, 9, 1), mx: Date.UTC(2026, 9, 10) }),
    })) as typeof tursoConnectionManager.getConnection;

    try {
      const result = await collectShardStats([
        {
          id: 1,
          scope: "user",
          scopeHash: "aaaaaaaaaaaaaaaa",
          shardIndex: 0,
          dbPath,
          vectorCount: 4,
          isActive: true,
        } as never,
      ]);

      expect(result.total).toBe(0);
      expect(result.byScope).toEqual({ user: 0, project: 0 });
      expect(result.byType).toEqual({});
      expect(result.shards).toHaveLength(1);
      expect(result.shards[0]).toMatchObject({
        memoryCount: 0,
        duplicateTagCount: 0,
        error: "duplicate query failed",
      });
    } finally {
      tursoConnectionManager.getConnection = original;
      rmSync(shardDir, { recursive: true, force: true });
    }
  });
});
