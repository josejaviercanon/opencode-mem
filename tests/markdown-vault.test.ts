import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  absPathForRel,
  deleteVaultFile,
  listMarkdownFiles,
  pluginMemoryRelPath,
  readVaultFile,
  writeVaultFile,
} from "../src/services/markdown/vault.js";

describe("markdown vault fs helpers", () => {
  let root: string;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("lists md files recursively and skips ignored dirs", () => {
    root = mkdtempSync(join(tmpdir(), "md-vault-"));
    mkdirSync(join(root, "notes"), { recursive: true });
    mkdirSync(join(root, ".obsidian"), { recursive: true });
    mkdirSync(join(root, ".git"), { recursive: true });
    writeFileSync(join(root, "root.md"), "root");
    writeFileSync(join(root, "notes", "a.md"), "a");
    writeFileSync(join(root, ".obsidian", "app.md"), "secret");
    writeFileSync(join(root, ".git", "x.md"), "secret");
    writeFileSync(join(root, "notes", "skip.txt"), "nope");

    const files = listMarkdownFiles(root);
    expect(files.map((f) => f.relPath).sort()).toEqual(["notes/a.md", "root.md"]);
  });

  it("writes and deletes plugin memory files", () => {
    root = mkdtempSync(join(tmpdir(), "md-vault-"));
    const rel = pluginMemoryRelPath("mem_1_abc");
    writeVaultFile(root, rel, "hello");
    expect(readVaultFile(root, rel)).toBe("hello");
    expect(deleteVaultFile(root, rel)).toBe(true);
    expect(deleteVaultFile(root, rel)).toBe(false);
  });

  it("refuses path escape", () => {
    root = mkdtempSync(join(tmpdir(), "md-vault-"));
    expect(() => absPathForRel(root, "../outside.md")).toThrow(/Invalid vault relative path/);
  });
});
