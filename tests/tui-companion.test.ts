import { describe, expect, it } from "bun:test";
import tuiPlugin from "../src/tui.js";
import { MemToast } from "../src/v2/toast-rpc.js";

describe("opencode-mem TUI companion", () => {
  it("subscribes to MemToast events and shows host toasts", () => {
    expect(tuiPlugin.id).toBe("opencode-mem-tui");

    const shown: unknown[] = [];
    let subscribedDefinition: unknown;
    let subscribedName: string | undefined;
    let handler: ((event: { data: unknown }) => void) | undefined;

    const cleanup = tuiPlugin.setup({
      client: {
        rpc: (definition: unknown) => {
          subscribedDefinition = definition;
          return {
            events: {
              on: (name: string, next: (event: { data: unknown }) => void) => {
                subscribedName = name;
                handler = next;
                return () => {
                  handler = undefined;
                };
              },
            },
          };
        },
      },
      ui: {
        toast: {
          show: (options: unknown) => {
            shown.push(options);
          },
        },
      },
    } as any);

    expect(subscribedDefinition).toBe(MemToast);
    expect(subscribedName).toBe("toast");
    expect(typeof cleanup).toBe("function");

    handler?.({
      data: {
        title: "Memory Captured",
        message: "Project memory saved from conversation",
        variant: "success",
        duration: 3000,
      },
    });

    expect(shown).toEqual([
      {
        title: "Memory Captured",
        message: "Project memory saved from conversation",
        variant: "success",
        duration: 3000,
      },
    ]);

    cleanup?.();
    expect(handler).toBeUndefined();
  });
});
