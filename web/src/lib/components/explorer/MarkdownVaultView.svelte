<script lang="ts">
  import FileText from "@lucide/svelte/icons/file-text";
  import FolderOpen from "@lucide/svelte/icons/folder-open";
  import Loader from "@lucide/svelte/icons/loader";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import type { MarkdownVaultFile, MarkdownVaultStatus } from "$lib/stores/markdown-vault.svelte";
  import Badge from "$lib/components/ui/badge.svelte";
  import Button from "$lib/components/ui/button.svelte";
  import EmptyState from "$lib/components/ui/empty-state.svelte";
  import MemoryActions from "$lib/components/explorer/MemoryActions.svelte";
  import { useI18n } from "$lib/i18n/context.svelte";
  import { formatDate } from "$lib/format";
  import { CARD_TITLE } from "$lib/memory-display";
  import {
    CARD_PAD,
    GAP,
    GAP_TIGHT,
    ICON_SM,
    STACK,
    STACK_TIGHT,
    SURFACE_CARD,
  } from "$lib/ui/styles";
  import { cn } from "$lib/utils";

  type Props = {
    status?: MarkdownVaultStatus | null;
    filtered?: MarkdownVaultFile[];
    loading?: boolean;
    reindexing?: boolean;
    error?: string | null;
    isSearching?: boolean;
    onReindex?: () => void;
    onEdit?: (file: MarkdownVaultFile) => void;
    onDelete?: (id: string) => void;
  };

  let {
    status = null,
    filtered,
    loading = false,
    reindexing = false,
    error = null,
    isSearching = false,
    onReindex,
    onEdit,
    onDelete,
  }: Props = $props();

  const i18n = useI18n();

  const allFiles = $derived(status?.files ?? []);
  const files = $derived(filtered ?? allFiles);

  function fileById(id: string): MarkdownVaultFile | undefined {
    return allFiles.find((f) => f.id === id) ?? files.find((f) => f.id === id);
  }
</script>

<div class={cn(STACK, "min-h-32")}>
  {#if loading && !status}
    <EmptyState>{i18n.t("loading-init")}</EmptyState>
  {:else if error && !status?.enabled}
    <EmptyState>{error}</EmptyState>
  {:else if !status?.enabled}
    <div class={cn("flex flex-col items-center py-10 text-muted-foreground", GAP)}>
      <FileText class="size-8" aria-hidden="true" />
      <p class="text-sm text-center max-w-md">{i18n.t("markdown-disabled")}</p>
    </div>
  {:else}
    <div class={cn(SURFACE_CARD, CARD_PAD, STACK_TIGHT)}>
      <div class={cn("flex flex-wrap items-start justify-between", GAP)}>
        <div class={cn(STACK_TIGHT, "min-w-0 flex-1")}>
          <div class={cn("flex items-center", GAP_TIGHT)}>
            <FolderOpen class={ICON_SM} aria-hidden="true" />
            <h2 class={CARD_TITLE}>{i18n.t("markdown-vault-path")}</h2>
          </div>
          <p class="truncate font-mono text-xs text-muted-foreground" title={status.path ?? ""}>
            {status.path}
          </p>
          <div class={cn("flex flex-wrap items-center", GAP_TIGHT)}>
            <Badge variant="secondary">
              {i18n.t("markdown-file-count", { count: status.fileCount })}
            </Badge>
            <Badge variant={status.watcherActive ? "default" : "outline"}>
              {status.watcherActive
                ? i18n.t("markdown-watcher-on")
                : i18n.t("markdown-watcher-off")}
            </Badge>
            {#if status.lastReconcileAt}
              <span class="text-xs text-muted-foreground">
                {i18n.t("markdown-last-sync", {
                  date: formatDate(new Date(status.lastReconcileAt).toISOString()),
                })}
              </span>
            {/if}
          </div>
        </div>
        <Button type="button" variant="outline" disabled={reindexing} onclick={() => onReindex?.()}>
          {#if reindexing}
            <Loader class={cn(ICON_SM, "animate-spin")} aria-hidden="true" />
          {:else}
            <RefreshCw class={ICON_SM} aria-hidden="true" />
          {/if}
          {i18n.t("markdown-reindex")}
        </Button>
      </div>
    </div>

    {#if allFiles.length === 0}
      <div class={cn("flex flex-col items-center py-10 text-muted-foreground", GAP)}>
        <FileText class="size-8" aria-hidden="true" />
        <p class="text-sm">{i18n.t("markdown-empty")}</p>
      </div>
    {:else if files.length === 0}
      <EmptyState>
        {isSearching ? i18n.t("markdown-search-empty") : i18n.t("markdown-empty")}
      </EmptyState>
    {:else}
      <div class={STACK_TIGHT}>
        {#each files as file (file.relPath)}
          <div class={cn(SURFACE_CARD, CARD_PAD, STACK_TIGHT)}>
            <div class={cn("flex items-center", GAP)}>
              <div class={cn("flex min-w-0 flex-1 items-center", GAP)}>
                <h3 class={cn(CARD_TITLE, "min-w-0")}>
                  <span class="truncate">{file.title || file.relPath}</span>
                </h3>
                {#if file.source}
                  <Badge variant="outline" class="shrink-0 text-[10px]">{file.source}</Badge>
                {/if}
              </div>
              <MemoryActions
                id={file.id}
                showPin={false}
                onEdit={onEdit
                  ? (id) => {
                      const target = fileById(id) ?? file;
                      onEdit(target);
                    }
                  : undefined}
                onDelete={onDelete ? (id) => onDelete(id) : undefined}
              />
            </div>
            <p class="truncate font-mono text-xs text-muted-foreground">{file.relPath}</p>
            <div class={cn("flex items-center text-xs text-muted-foreground", GAP_TIGHT)}>
              <span>{formatDate(new Date(file.mtimeMs).toISOString())}</span>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</div>
