<script lang="ts">
  import type { Snippet } from "svelte";
  import Dialog from "$lib/components/ui/dialog.svelte";
  import DialogFooter from "$lib/components/ui/dialog-footer.svelte";
  import DialogHeader from "$lib/components/ui/dialog-header.svelte";
  import DialogTitle from "$lib/components/ui/dialog-title.svelte";

  type Props = {
    open?: boolean;
    title: string;
    class?: string;
    showCloseButton?: boolean;
    onOpenChange?: (open: boolean) => void;
    children?: Snippet;
    footer?: Snippet;
  };

  let {
    open = $bindable(false),
    title,
    class: className,
    showCloseButton = true,
    onOpenChange,
    children,
    footer,
  }: Props = $props();
</script>

<Dialog bind:open {onOpenChange} class={className} {showCloseButton}>
  <DialogHeader class="shrink-0 pe-10">
    <DialogTitle>{title}</DialogTitle>
  </DialogHeader>
  <!-- pt so floating field labels (top-0 -translate-y-1/2) are not clipped -->
  <div class="flex min-h-0 flex-1 flex-col overflow-y-auto pt-4">
    {@render children?.()}
  </div>
  {#if footer}
    <DialogFooter class="shrink-0">
      {@render footer()}
    </DialogFooter>
  {/if}
</Dialog>
