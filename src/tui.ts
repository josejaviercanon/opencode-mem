import { define } from "@opencode/plugin/tui/plugin";
import { MemToast, type MemToastPayload } from "./v2/toast-rpc.js";

/**
 * TUI companion for opencode-mem. Subscribes to server-emitted toast RPC
 * events and renders them with the host toast UI.
 *
 * Import from `@opencode/plugin/tui/plugin` (not `@opencode/plugin/tui`) so
 * the companion does not pull optional Solid peer deps into the package load.
 */
export default define({
  id: "opencode-mem-tui",
  setup(ctx) {
    return ctx.client.rpc(MemToast).events.on("toast", (event) => {
      ctx.ui.toast.show(event.data as MemToastPayload);
    });
  },
});
