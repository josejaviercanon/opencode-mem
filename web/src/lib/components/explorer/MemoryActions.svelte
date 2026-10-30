<script lang="ts">
  import PenLine from "@lucide/svelte/icons/pen-line";
  import Pin from "@lucide/svelte/icons/pin";
  import PinOff from "@lucide/svelte/icons/pin-off";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import Button from "$lib/components/ui/button.svelte";
  import { useI18n } from "$lib/i18n/context.svelte";
  import { ICON_SM } from "$lib/ui/styles";

  type Props = {
    id: string;
    pinned?: boolean;
    isLinked?: boolean;
    deleteLabel?: string;
    /** Show pin/unpin controls (memories). Default true. */
    showPin?: boolean;
    onPin?: (id: string) => void;
    onUnpin?: (id: string) => void;
    onEdit?: (id: string) => void;
    onDelete?: (id: string, isLinked: boolean) => void;
  };

  let {
    id,
    pinned = false,
    isLinked = false,
    deleteLabel,
    showPin = true,
    onPin,
    onUnpin,
    onEdit,
    onDelete,
  }: Props = $props();

  const i18n = useI18n();
  const resolvedDeleteLabel = $derived(deleteLabel ?? i18n.t("btn-delete"));
</script>

<div class="flex shrink-0 items-center gap-1">
  {#if showPin}
    {#if pinned}
      <Button
        variant="ghost"
        size="icon-xs"
        class="text-primary hover:text-primary"
        title={i18n.t("btn-unpin")}
        aria-label={i18n.t("btn-unpin")}
        onclick={() => onUnpin?.(id)}
      >
        <PinOff class={ICON_SM} aria-hidden="true" />
      </Button>
    {:else}
      <Button
        variant="ghost"
        size="icon-xs"
        title={i18n.t("btn-pin")}
        aria-label={i18n.t("btn-pin")}
        onclick={() => onPin?.(id)}
      >
        <Pin class={ICON_SM} aria-hidden="true" />
      </Button>
    {/if}
  {/if}
  {#if onEdit}
    <Button
      variant="ghost"
      size="icon-xs"
      title={i18n.t("btn-edit")}
      aria-label={i18n.t("btn-edit")}
      onclick={() => onEdit?.(id)}
    >
      <PenLine class={ICON_SM} aria-hidden="true" />
    </Button>
  {/if}
  {#if onDelete}
    <Button
      variant="destructive"
      size="icon-xs"
      title={resolvedDeleteLabel}
      aria-label={resolvedDeleteLabel}
      onclick={() => onDelete?.(id, isLinked)}
    >
      <Trash2 class={ICON_SM} aria-hidden="true" />
    </Button>
  {/if}
</div>
