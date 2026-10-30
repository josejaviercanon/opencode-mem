import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

describe("markdown write-through", () => {
  let baseDir: string;
  let restoreEmbedding: (() => void) | undefined;
  let previousBackend: "database" | "markdown" | undefined;
  let previousMarkdownPath: string | undefined;

  afterEach(async () => {
    restoreEmbedding?.();
    restoreEmbedding = undefined;
    const { CONFIG } = await import("../src/config.js");
    if (previousBackend !== undefined) CONFIG.memoryBackend = previousBackend;
    CONFIG.markdownPath = previousMarkdownPath;
    previousBackend = undefined;
    previousMarkdownPath = undefined;
    const { stopMarkdownBackend } = await import("../src/services/markdown/backend.js");
    stopMarkdownBackend();
    if (baseDir) await cleanupTursoTestDirectory(baseDir);
  });

  async function stubEmbedding() {
    const { embeddingService } = await import("../src/services/embedding.js");
    const service = embeddingService as any;
    const original = {
      warmup: service.warmup,
      clearCache: service.clearCache,
      embedWithTimeout: service.embedWithTimeout,
      isWarmedUp: service.isWarmedUp,
    };
    service.warmup = async () => {
      service.isWarmedUp = true;
    };
    service.clearCache = () => {};
    service.embedWithTimeout = async () => new Float32Array([1, 0]);
    restoreEmbedding = () => Object.assign(service, original);
  }

  it("writes markdown file on add and removes it on delete", async () => {
    baseDir = mkdtempSync(join(tmpdir(), "md-wt-"));
    const vault = join(baseDir, "vault");
    const storage = join(baseDir, "storage");

    const { CONFIG } = await import("../src/config.js");
    previousBackend = CONFIG.memoryBackend;
    previousMarkdownPath = CONFIG.markdownPath;
    CONFIG.storagePath = storage;
    CONFIG.embeddingDimensions = 2;
    CONFIG.containerTagPrefix = "opencode";
    CONFIG.memoryBackend = "markdown";
    CONFIG.markdownPath = vault;

    await stubEmbedding();

    const { memoryClient } = await import("../src/services/client.js");
    memoryClient.reset();

    const { getProjectTagInfo } = await import("../src/services/tags.js");
    const tag = getProjectTagInfo(baseDir);

    const added = await memoryClient.addMemory("vault write-through note", tag.tag, {
      source: "manual",
      type: "fact",
      tags: ["wt"],
    });
    expect(added.success).toBe(true);
    if (!added.success) return;

    const filePath = join(vault, `${added.id}.md`);
    expect(existsSync(filePath)).toBe(true);
    const body = readFileSync(filePath, "utf-8");
    expect(body).toContain("vault write-through note");
    expect(body).toContain(added.id);

    const deleted = await memoryClient.deleteMemory(added.id);
    expect(deleted.success).toBe(true);
    expect(existsSync(filePath)).toBe(false);
  });

  it("reconcile indexes foreign markdown pages", async () => {
    baseDir = mkdtempSync(join(tmpdir(), "md-rec-"));
    const vault = join(baseDir, "vault");
    const storage = join(baseDir, "storage");

    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(vault, { recursive: true });
    writeFileSync(
      join(vault, "wiki-page.md"),
      `---
title: "Wiki Page"
tags: [wiki]
---

Imported wiki content.
`
    );

    const { CONFIG } = await import("../src/config.js");
    previousBackend = CONFIG.memoryBackend;
    previousMarkdownPath = CONFIG.markdownPath;
    CONFIG.storagePath = storage;
    CONFIG.embeddingDimensions = 2;
    CONFIG.containerTagPrefix = "opencode";
    CONFIG.memoryBackend = "markdown";
    CONFIG.markdownPath = vault;

    await stubEmbedding();

    const { reconcileMarkdownVault } = await import("../src/services/markdown/reconcile.js");
    const result = await reconcileMarkdownVault();
    expect(result.scanned).toBe(1);
    expect(result.upserted).toBe(1);
    expect(result.errors).toEqual([]);

    const { markdownIdFromRelPath } = await import("../src/services/markdown/document.js");
    const id = markdownIdFromRelPath("wiki-page.md");

    const { tursoShardManager } = await import("../src/services/turso/shard-manager.js");
    const { tursoConnectionManager } = await import("../src/services/turso/connection-manager.js");
    const { tursoVectorSearch } = await import("../src/services/turso/vector-search.js");
    const userShards = await tursoShardManager.getAllShards("user", "");
    let found = false;
    for (const shard of userShards) {
      const db = await tursoConnectionManager.getConnection(shard.dbPath);
      const row = await tursoVectorSearch.getMemoryById(db, id);
      if (row) {
        found = true;
        expect(String(row.content)).toContain("Imported wiki content");
      }
    }
    expect(found).toBe(true);
  });
});
