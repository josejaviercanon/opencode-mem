import { watch, type FSWatcher } from "node:fs";
import { resolve } from "node:path";
import { log } from "../logger.js";
import { isIgnoredVaultSegment, isMarkdownPath, vaultRelFromAbs } from "./vault.js";
import { reindexVaultFile, reconcileMarkdownVault } from "./reconcile.js";

const DEFAULT_DEBOUNCE_MS = 400;

export class MarkdownVaultWatcher {
  private watcher: FSWatcher | null = null;
  private vaultRoot: string | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingRels = new Set<string>();
  private fullRescan = false;
  private readonly pendingSelfWrites = new Set<string>();
  private readonly debounceMs: number;
  private running = false;

  constructor(debounceMs = DEFAULT_DEBOUNCE_MS) {
    this.debounceMs = debounceMs;
  }

  get active(): boolean {
    return this.watcher !== null;
  }

  /** Suppress watcher reactions for plugin-owned writes. */
  noteSelfWrite(relPath: string): void {
    const normalized = relPath.replace(/\\/g, "/");
    this.pendingSelfWrites.add(normalized);
    setTimeout(() => this.pendingSelfWrites.delete(normalized), this.debounceMs * 3);
  }

  start(vaultRoot: string): void {
    this.stop();
    const root = resolve(vaultRoot);
    this.vaultRoot = root;
    try {
      this.watcher = watch(root, { recursive: true }, (eventType, filename) => {
        this.onFsEvent(eventType, filename);
      });
      this.watcher.on("error", (error) => {
        log("markdown vault watcher error", { error: String(error) });
      });
      this.running = true;
      log("markdown vault watcher started", { path: root });
    } catch (error) {
      log("markdown vault watcher failed to start", { error: String(error), path: root });
      this.watcher = null;
      this.running = false;
    }
  }

  stop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.pendingRels.clear();
    this.fullRescan = false;
    if (this.watcher) {
      try {
        this.watcher.close();
      } catch {
        /* ignore */
      }
      this.watcher = null;
    }
    this.running = false;
    this.vaultRoot = null;
  }

  private onFsEvent(_eventType: string, filename: string | Buffer | null): void {
    if (!this.vaultRoot) return;
    if (filename == null) {
      this.fullRescan = true;
      this.scheduleFlush();
      return;
    }
    const name = typeof filename === "string" ? filename : filename.toString();
    const normalized = name.replace(/\\/g, "/");
    const segments = normalized.split("/");
    if (segments.some((s) => isIgnoredVaultSegment(s))) return;
    if (!isMarkdownPath(normalized) && !this.looksLikeDeleteOfMarkdown(normalized)) {
      return;
    }
    if (this.pendingSelfWrites.has(normalized)) return;

    try {
      // Normalize via vault helpers when possible.
      const abs = resolve(this.vaultRoot, normalized);
      const rel = vaultRelFromAbs(this.vaultRoot, abs);
      if (this.pendingSelfWrites.has(rel)) return;
      this.pendingRels.add(rel);
    } catch {
      this.fullRescan = true;
    }
    this.scheduleFlush();
  }

  private looksLikeDeleteOfMarkdown(path: string): boolean {
    // Some platforms omit extension on rename/delete events; still queue a rescan.
    return path.length > 0 && !path.includes(".");
  }

  private scheduleFlush(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      void this.flush();
    }, this.debounceMs);
  }

  private async flush(): Promise<void> {
    this.debounceTimer = null;
    if (!this.running) return;

    const doFull = this.fullRescan;
    const rels = [...this.pendingRels];
    this.pendingRels.clear();
    this.fullRescan = false;

    try {
      if (doFull || rels.length > 20) {
        await reconcileMarkdownVault();
        return;
      }
      for (const rel of rels) {
        await reindexVaultFile(rel);
      }
    } catch (error) {
      log("markdown vault watcher flush error", { error: String(error) });
    }
  }
}

export const markdownVaultWatcher = new MarkdownVaultWatcher();
