<script lang="ts">
  import Button from "$lib/components/ui/button.svelte";
  import Textarea from "$lib/components/ui/textarea.svelte";
  import { useI18n } from "$lib/i18n/context.svelte";
  import { renderMarkdown } from "$lib/markdown";
  import { CARD_PAD, GAP_TIGHT, SURFACE_CARD } from "$lib/ui/styles";
  import { cn } from "$lib/utils";

  type Props = {
    id: string;
    label: string;
    value?: string;
    rows?: number;
    required?: boolean;
    placeholder?: string;
    /** Reset to edit mode when this becomes true (e.g. dialog open). */
    resetKey?: boolean;
  };

  let {
    id,
    label,
    value = $bindable(""),
    rows = 6,
    required = false,
    placeholder = "",
    resetKey = false,
  }: Props = $props();

  const i18n = useI18n();
  let mode = $state<"edit" | "preview">("edit");

  $effect(() => {
    if (resetKey) mode = "edit";
  });

  const previewHtml = $derived(renderMarkdown(value || ""));
</script>

<div class="space-y-2">
  <div class={cn("flex items-center justify-between", GAP_TIGHT)}>
    <label for={id} class="text-xs font-medium text-foreground">{label}</label>
    <div class={cn("flex items-center", GAP_TIGHT)}>
      <Button
        type="button"
        variant={mode === "edit" ? "secondary" : "ghost"}
        size="xs"
        onclick={() => (mode = "edit")}
      >
        {i18n.t("btn-edit")}
      </Button>
      <Button
        type="button"
        variant={mode === "preview" ? "secondary" : "ghost"}
        size="xs"
        onclick={() => (mode = "preview")}
      >
        {i18n.t("skill-preview")}
      </Button>
    </div>
  </div>

  {#if mode === "edit"}
    <Textarea {id} {rows} {required} {placeholder} bind:value />
  {:else}
    <div
      class={cn(
        SURFACE_CARD,
        CARD_PAD,
        "markdown-content prose-invert max-w-none min-h-48 max-h-80 overflow-y-auto text-sm"
      )}
    >
      {#if value.trim()}
        {@html previewHtml}
      {:else}
        <p class="text-muted-foreground">{placeholder || i18n.t("label-content")}</p>
      {/if}
    </div>
  {/if}
</div>
