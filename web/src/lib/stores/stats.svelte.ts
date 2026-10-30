import { fetchAPI } from "$lib/api";

export type StatsShard = {
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
};

export type StatsDaily = {
  date: string;
  captures: number;
  captureSkipped: number;
  profileInjections: number;
  compactionInjections: number;
  errors: Record<string, number>;
};

export type StatsData = {
  total: number;
  byScope: { user: number; project: number };
  byType: Record<string, number>;
  generatedAt: string;
  // Older or partially available responses can omit diagnostic sections.
  shards?: StatsShard[];
  profile?: {
    exists: boolean;
    version?: number;
    counts?: { preferences: number; patterns: number; workflows: number };
    lastAnalyzedAt?: string;
    totalPromptsAnalyzed?: number;
    error?: string;
  };
  daily?: StatsDaily[];
  dailyError?: string;
};

export function createStatsStore() {
  let data = $state<StatsData | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);

  async function loadStats() {
    loading = true;
    error = null;
    const result = await fetchAPI<StatsData>("/api/stats");
    loading = false;
    if (result.success && result.data) {
      data = result.data;
    } else {
      // Keep the last snapshot visible; an empty error still signals failure.
      error = result.error || "";
    }
  }

  return {
    get data() {
      return data;
    },
    get loading() {
      return loading;
    },
    get error() {
      return error;
    },
    loadStats,
  };
}
