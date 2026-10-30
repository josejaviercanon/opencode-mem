import { fetchAPI, toastApiResult } from "$lib/api";

export type MarkdownVaultFile = {
  id: string;
  relPath: string;
  title?: string;
  mtimeMs: number;
  source?: string;
  containerTag?: string;
};

export type MarkdownVaultStatus = {
  enabled: boolean;
  path: string | null;
  fileCount: number;
  lastReconcileAt: number | null;
  watcherActive: boolean;
  files: MarkdownVaultFile[];
};

export function createMarkdownVaultStore() {
  let status = $state<MarkdownVaultStatus | null>(null);
  let loading = $state(false);
  let reindexing = $state(false);
  let error = $state<string | null>(null);
  let searchInput = $state("");

  const files = $derived(status?.files ?? []);

  const filteredFiles = $derived.by(() => {
    const query = searchInput.trim().toLowerCase();
    if (!query) return files;
    return files.filter((file) => {
      const haystack =
        `${file.id} ${file.relPath} ${file.title ?? ""} ${file.source ?? ""}`.toLowerCase();
      return haystack.includes(query);
    });
  });

  const isSearching = $derived(searchInput.trim().length > 0);

  async function loadStatus() {
    loading = true;
    error = null;
    try {
      const result = await fetchAPI<MarkdownVaultStatus>("/api/markdown/status");
      if (result.success && result.data) {
        status = result.data;
      } else {
        status = {
          enabled: false,
          path: null,
          fileCount: 0,
          lastReconcileAt: null,
          watcherActive: false,
          files: [],
        };
        if (result.error) error = result.error;
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      status = {
        enabled: false,
        path: null,
        fileCount: 0,
        lastReconcileAt: null,
        watcherActive: false,
        files: [],
      };
    } finally {
      loading = false;
    }
  }

  async function reindex() {
    reindexing = true;
    try {
      const result = await fetchAPI("/api/markdown/reindex", { method: "POST" });
      await toastApiResult(result, {
        successKey: "markdown-reindex-ok",
        failKey: "markdown-reindex-fail",
      });
      await loadStatus();
    } finally {
      reindexing = false;
    }
  }

  function clearSearch() {
    searchInput = "";
  }

  return {
    get status() {
      return status;
    },
    get loading() {
      return loading;
    },
    get reindexing() {
      return reindexing;
    },
    get error() {
      return error;
    },
    get enabled() {
      return status?.enabled === true;
    },
    get searchInput() {
      return searchInput;
    },
    set searchInput(v: string) {
      searchInput = v;
    },
    get filteredFiles() {
      return filteredFiles;
    },
    get isSearching() {
      return isSearching;
    },
    loadStatus,
    reindex,
    clearSearch,
  };
}
