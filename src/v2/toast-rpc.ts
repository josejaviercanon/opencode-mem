import { Rpc } from "@opencode/plugin/rpc";

/**
 * Shared server↔TUI contract for toast intents.
 * Server plugins have no ui.toast; they emit via rpc.register events,
 * and the ./tui companion renders with ctx.ui.toast.show.
 */
export const MemToast = Rpc.define({
  id: "opencode-mem",
  methods: {},
  events: {
    toast: {
      schema: {
        type: "object",
        properties: {
          title: { type: "string" },
          message: { type: "string" },
          variant: { type: "string" },
          duration: { type: "number" },
          sessionID: { type: "string" },
        },
        required: ["message"],
        additionalProperties: false,
      },
    },
  },
});

export type MemToastPayload = {
  readonly message: string;
  readonly title?: string;
  readonly variant?: "info" | "success" | "warning" | "error";
  readonly duration?: number;
  readonly sessionID?: string;
};
