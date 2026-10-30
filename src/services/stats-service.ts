import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { CONFIG } from "../config.js";
import { tursoConnectionManager } from "./turso/connection-manager.js";
import type { ShardInfo } from "./turso/types.js";
import type { UserProfile } from "./user-profile/types.js";

export type DailyCounter =
  "captures" | "captureSkipped" | "profileInjections" | "compactionInjections";

export interface ParsedLogLine {
  date: string;
  message: string;
  payload?: string;
}

export interface LogClassification {
  counter?: DailyCounter;
  errorBucket?: string;
}

export interface DailyStats {
  date: string;
  captures: number;
  captureSkipped: number;
  profileInjections: number;
  compactionInjections: number;
  errors: Record<string, number>;
}

export interface ShardStats {
  shardId: number | null;
  scope: "user" | "project";
  scopeHash: string;
  shardIndex: number;
  fileName: string;
  fileExists: boolean;
  isActive: boolean;
  registeredVectorCount: number;
  memoryCount: number;
  oldestCreatedAt: string | null;
  newestCreatedAt: string | null;
  duplicateTagCount: number;
  error?: string;
}

export interface ShardCollection {
  shards: ShardStats[];
  total: number;
  byScope: { user: number; project: number };
  byType: Record<string, number>;
}

interface CachedLogEvent {
  date: string;
  classification: LogClassification;
}

interface CachedLogFile {
  signature: string;
  events: CachedLogEvent[];
}

const parsedLogFiles = new Map<string, CachedLogFile>();

/** Parse a structured logger line, splitting the message only at the first `: {`. */
export function parseLogLine(line: string): ParsedLogLine | null {
  const normalizedLine = line.endsWith("\r") ? line.slice(0, -1) : line;
  const match = normalizedLine.match(
    /^\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2})\]\s(.*)$/
  );
  if (!match || !Number.isFinite(Date.parse(match[1]!))) return null;

  const content = match[2]!;
  const payloadSeparator = content.indexOf(": {");
  if (payloadSeparator === -1) {
    return { date: match[1]!.slice(0, 10), message: content };
  }

  return {
    date: match[1]!.slice(0, 10),
    message: content.slice(0, payloadSeparator),
    payload: content.slice(payloadSeparator + 2),
  };
}

/** Classify a parsed logger message as one daily counter or a named error bucket. */
export function classifyLogMessage(message: string): LogClassification {
  if (message.startsWith("Auto-capture memory persisted")) return { counter: "captures" };
  if (message.startsWith("Auto-capture skipped")) return { counter: "captureSkipped" };
  if (message.startsWith("profile inject")) return { counter: "profileInjections" };
  if (message.startsWith("Compaction memory injected")) {
    return { counter: "compactionInjections" };
  }

  if (message.startsWith("Turso ready gate failed")) {
    return { errorBucket: "Turso ready gate failed" };
  }
  if (message.startsWith("Failed to load skills for OpenCode registration")) {
    return { errorBucket: "Failed to load skills for OpenCode registration" };
  }
  if (message.startsWith("Auto-capture final error")) {
    return { errorBucket: "Auto-capture final error" };
  }
  if (message.startsWith("Compaction handler error")) {
    return { errorBucket: "Compaction handler error" };
  }
  if (message.startsWith("Idle processing error")) {
    return { errorBucket: "Idle processing error" };
  }

  // Match `listMemories: error`, `chat.message: ERROR`, etc.
  const errorSuffix = message.match(/^(.*):\s*error$/i);
  if (errorSuffix) {
    return { errorBucket: errorSuffix[1]!.trim() };
  }
  return {};
}

function formatLocalDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function zeroDay(date: string): DailyStats {
  return {
    date,
    captures: 0,
    captureSkipped: 0,
    profileInjections: 0,
    compactionInjections: 0,
    errors: {},
  };
}

function listLogFiles(logDir: string): string[] {
  try {
    const files = readdirSync(logDir);
    return files
      .filter((file) => /^opencode-mem-\d{4}-\d{2}-\d{2}\.log$/.test(file))
      .map((file) => join(logDir, file))
      .concat(
        ["opencode-mem.log", "opencode-mem.log.old"]
          .filter((file) => files.includes(file))
          .map((file) => join(logDir, file))
      );
  } catch {
    return [];
  }
}

function getCachedEvents(filePath: string): CachedLogEvent[] | null {
  try {
    const stats = statSync(filePath);
    if (!stats.isFile()) return null;

    const signature = `${stats.size}:${stats.mtimeMs}`;
    const cached = parsedLogFiles.get(filePath);
    if (cached?.signature === signature) return cached.events;

    const events: CachedLogEvent[] = [];
    for (const line of readFileSync(filePath, "utf8").split("\n")) {
      const parsed = parseLogLine(line);
      if (!parsed) continue;
      const classification = classifyLogMessage(parsed.message);
      if (classification.counter || classification.errorBucket) {
        events.push({ date: parsed.date, classification });
      }
    }
    parsedLogFiles.set(filePath, { signature, events });
    return events;
  } catch {
    parsedLogFiles.delete(filePath);
    return null;
  }
}

export interface CollectDailyStatsOptions {
  logDir?: string;
  days?: number;
  now?: Date;
}

/**
 * Mirrors the log file resolution in services/logger.ts without importing it:
 * the API-handler scenario tests mock logger.js with a minimal surface, so a
 * static import of any other export from that module breaks their import graph.
 */
function defaultLogDir(): string {
  const logFile =
    process.env.OPENCODE_MEM_LOG_FILE || join(homedir(), ".opencode-mem", "opencode-mem.log");
  const lastSlash = Math.max(logFile.lastIndexOf("/"), logFile.lastIndexOf("\\"));
  return lastSlash === -1 ? "." : logFile.slice(0, lastSlash);
}

/** Read and aggregate structured log counters into a local-date, zero-filled series. */
export function collectDailyStats({
  logDir = defaultLogDir(),
  days = 14,
  now = new Date(),
}: CollectDailyStatsOptions = {}): DailyStats[] {
  const dayCount = Math.max(1, Math.floor(days));
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daily = new Map<string, DailyStats>();

  for (let offset = dayCount - 1; offset >= 0; offset--) {
    const date = new Date(end);
    date.setDate(end.getDate() - offset);
    const key = formatLocalDate(date);
    daily.set(key, zeroDay(key));
  }

  const files = listLogFiles(logDir);
  const foundFiles = new Set(files);
  const normalizedDir = join(logDir, ".");
  for (const path of parsedLogFiles.keys()) {
    if (path.startsWith(normalizedDir) && !foundFiles.has(path)) parsedLogFiles.delete(path);
  }

  for (const filePath of files) {
    const events = getCachedEvents(filePath);
    if (!events) continue;
    for (const { date, classification } of events) {
      const day = daily.get(date);
      if (!day) continue;
      if (classification.counter) {
        day[classification.counter]++;
      } else if (classification.errorBucket) {
        day.errors[classification.errorBucket] = (day.errors[classification.errorBucket] ?? 0) + 1;
      }
    }
  }

  return [...daily.values()];
}

function toISOStringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp)) return null;
  try {
    return new Date(timestamp).toISOString();
  } catch {
    return null;
  }
}

/** Collects registered shard health while preserving the existing stats totals. */
export async function collectShardStats(shards: ShardInfo[]): Promise<ShardCollection> {
  const shardStats: ShardStats[] = [];
  let userCount = 0;
  let projectCount = 0;
  const typeCount: Record<string, number> = {};

  for (const shard of shards) {
    const stats: ShardStats = {
      shardId: Number.isFinite(shard.id) ? shard.id : null,
      scope: shard.scope,
      scopeHash: shard.scopeHash,
      shardIndex: shard.shardIndex,
      fileName: basename(shard.dbPath),
      fileExists: existsSync(shard.dbPath),
      isActive: shard.isActive,
      registeredVectorCount: shard.vectorCount,
      memoryCount: 0,
      oldestCreatedAt: null,
      newestCreatedAt: null,
      duplicateTagCount: 0,
    };

    if (!stats.fileExists) {
      stats.error = `Shard DB file missing: ${stats.fileName}`;
      shardStats.push(stats);
      continue;
    }

    try {
      const db = await tursoConnectionManager.getConnection(shard.dbPath);

      // Aggregate instead of `SELECT *` (getAllMemories): stats is polled every
      // 30s by the web UI and must not drag vector blobs for every memory.
      // Accumulators stay local until every query for this shard succeeds so a
      // mid-walk failure cannot inflate global totals while memoryCount stays 0.
      let shardUserCount = 0;
      let shardProjectCount = 0;
      const shardTypeCount: Record<string, number> = {};

      const scopeTypeCounts = await db.all<{
        container_tag: unknown;
        type: unknown;
        c: number | bigint;
      }>("SELECT container_tag, type, COUNT(*) c FROM memories GROUP BY container_tag, type");
      for (const row of scopeTypeCounts) {
        const containerTag = String(row.container_tag ?? "");
        const type = row.type ? String(row.type) : "";
        const count = Number(row.c ?? 0);
        if (containerTag.includes("_user_")) shardUserCount += count;
        else if (containerTag.includes("_project_")) shardProjectCount += count;
        if (type) shardTypeCount[type] = (shardTypeCount[type] || 0) + count;
      }

      const aggregate = await db.get<{ c: number | bigint; mn: unknown; mx: unknown }>(
        "SELECT COUNT(*) c, MIN(created_at) mn, MAX(created_at) mx FROM memories"
      );
      stats.memoryCount = Number(aggregate?.c ?? 0);
      stats.oldestCreatedAt = toISOStringOrNull(aggregate?.mn);
      stats.newestCreatedAt = toISOStringOrNull(aggregate?.mx);

      const duplicateTags = await db.all<{ c: number | bigint }>(
        "SELECT tags, COUNT(*) c FROM memories WHERE tags IS NOT NULL AND tags != '' GROUP BY tags HAVING COUNT(*) > 1"
      );
      stats.duplicateTagCount = duplicateTags.reduce(
        (total, row) => total + Math.max(0, Number(row.c) - 1),
        0
      );

      userCount += shardUserCount;
      projectCount += shardProjectCount;
      for (const [type, count] of Object.entries(shardTypeCount)) {
        typeCount[type] = (typeCount[type] || 0) + count;
      }
    } catch (error) {
      stats.memoryCount = 0;
      stats.oldestCreatedAt = null;
      stats.newestCreatedAt = null;
      stats.duplicateTagCount = 0;
      stats.error = error instanceof Error ? error.message : String(error);
    }

    shardStats.push(stats);
  }

  return {
    shards: shardStats,
    total: userCount + projectCount,
    byScope: { user: userCount, project: projectCount },
    byType: typeCount,
  };
}

export interface ProfileStats {
  exists: boolean;
  version?: number;
  counts?: { preferences: number; patterns: number; workflows: number };
  lastAnalyzedAt?: string;
  totalPromptsAnalyzed?: number;
  error?: string;
}

/** Read the active user's compact profile summary without returning profile contents. */
export async function collectProfileStats(): Promise<ProfileStats> {
  const profileDbPath = join(CONFIG.storagePath || "", "user-profiles.db");
  if (!existsSync(profileDbPath)) return { exists: false };

  let profile: UserProfile | null;
  try {
    const { userProfileManager } = await import("./user-profile/user-profile-manager.js");
    const { getTags } = await import("./tags.js");
    const targetUserId = getTags(process.cwd()).user.userEmail || "unknown";
    profile = await userProfileManager.getActiveProfile(targetUserId);
  } catch (error) {
    return {
      exists: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  if (!profile) return { exists: false };

  try {
    const data = JSON.parse(profile.profileData) as Record<string, unknown>;
    const arrayCount = (value: unknown) => (Array.isArray(value) ? value.length : 0);
    const lastAnalyzedAt = toISOStringOrNull(profile.lastAnalyzedAt);
    return {
      exists: true,
      version: Number(profile.version),
      counts: {
        preferences: arrayCount(data.preferences),
        patterns: arrayCount(data.patterns),
        workflows: arrayCount(data.workflows),
      },
      ...(lastAnalyzedAt ? { lastAnalyzedAt } : {}),
      totalPromptsAnalyzed: Number(profile.totalPromptsAnalyzed),
    };
  } catch (error) {
    return {
      exists: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
