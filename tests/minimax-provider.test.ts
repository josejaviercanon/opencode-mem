import { afterEach, describe, expect, it } from "bun:test";
import { MiniMaxProvider } from "../src/services/ai/providers/minimax.js";
import { AIProviderFactory } from "../src/services/ai/ai-provider-factory.js";
import type { ChatCompletionTool } from "../src/services/ai/tools/tool-schema.js";
import { readFileSync } from "node:fs";
import { buildMemoryProviderConfig } from "../src/services/ai/provider-config.js";

const toolSchema: ChatCompletionTool = {
  type: "function",
  function: {
    name: "save_memories",
    description: "Save memories",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
};

class FakeSessionManager {
  private readonly session = { id: "session-1" };
  private readonly messages: any[] = [];
  lastCreateSessionArgs: any;

  getSession(sessionId?: string, provider?: string): any {
    void sessionId;
    void provider;
    return null;
  }

  createSession(args: any): any {
    this.lastCreateSessionArgs = args;
    return this.session;
  }

  getMessages(): any[] {
    return this.messages;
  }

  getLastSequence(): number {
    return this.messages.length - 1;
  }

  addMessage(message: any): void {
    this.messages.push(message);
  }
}

function makeProvider(
  overrides: Record<string, unknown> = {},
  sessionManager = new FakeSessionManager()
) {
  return {
    provider: new MiniMaxProvider(
      {
        model: "MiniMax-M3",
        apiUrl: "https://api.minimax.io",
        apiKey: "test-key",
        ...overrides,
      },
      sessionManager as any
    ),
    sessionManager,
  };
}

describe("MiniMaxProvider", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("reports the minimax provider name", () => {
    const { provider } = makeProvider();
    expect(provider.getProviderName()).toBe("minimax");
    expect(provider.supportsSession()).toBe(true);
  });

  it("resolves the global endpoint at /anthropic/v1/messages", () => {
    const { provider } = makeProvider();
    expect(provider.resolveEndpoint()).toBe("https://api.minimax.io/anthropic/v1/messages");
  });

  it("resolves the current China endpoint at api.minimax.cn", () => {
    const { provider } = makeProvider({ apiUrl: "https://api.minimax.cn" });
    expect(provider.resolveEndpoint()).toBe("https://api.minimax.cn/anthropic/v1/messages");
  });

  it("resolves a legacy China endpoint at api.minimaxi.com", () => {
    const { provider } = makeProvider({ apiUrl: "https://api.minimaxi.com" });
    expect(provider.resolveEndpoint()).toBe("https://api.minimaxi.com/anthropic/v1/messages");
  });

  it("normalizes a base URL that already includes /anthropic/v1", () => {
    const { provider } = makeProvider({ apiUrl: "https://api.minimax.io/anthropic/v1" });
    expect(provider.resolveEndpoint()).toBe("https://api.minimax.io/anthropic/v1/messages");
  });

  it("normalizes a base URL that includes /anthropic", () => {
    const { provider } = makeProvider({ apiUrl: "https://api.minimax.io/anthropic/" });
    expect(provider.resolveEndpoint()).toBe("https://api.minimax.io/anthropic/v1/messages");
  });

  it("normalizes a full /anthropic/v1/messages URL without duplicating the path", () => {
    const { provider } = makeProvider({
      apiUrl: "https://api.minimax.io/anthropic/v1/messages",
    });
    expect(provider.resolveEndpoint()).toBe("https://api.minimax.io/anthropic/v1/messages");
  });

  it("strips a trailing slash from the base URL", () => {
    const { provider } = makeProvider({ apiUrl: "https://api.minimax.io/" });
    expect(provider.resolveEndpoint()).toBe("https://api.minimax.io/anthropic/v1/messages");
  });

  it("throws when memoryApiUrl is not configured", () => {
    const { provider } = makeProvider({ apiUrl: "" });
    expect(() => provider.resolveEndpoint()).toThrow();
  });

  it("records the minimax session provider tag", async () => {
    globalThis.fetch = (async () =>
      ({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: async () => "login fail",
      }) as Response) as typeof fetch;

    const { provider, sessionManager } = makeProvider();
    await provider.executeToolCall("system", "user", toolSchema, "session-id");

    expect(sessionManager.lastCreateSessionArgs?.provider).toBe("minimax");
  });

  it("targets /anthropic/v1/messages and authenticates with x-api-key", async () => {
    let capturedUrl: string | undefined;
    let capturedHeaders: Record<string, string> | undefined;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedHeaders = init?.headers as Record<string, string>;
      return {
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: async () => "login fail",
      } as Response;
    }) as typeof fetch;

    const { provider } = makeProvider();
    await provider.executeToolCall("system", "user", toolSchema, "session-id");

    expect(capturedUrl).toBe("https://api.minimax.io/anthropic/v1/messages");
    expect(capturedHeaders?.["x-api-key"]).toBe("test-key");
    expect(capturedHeaders?.["anthropic-version"]).toBe("2023-06-01");
  });

  it("forwards adaptive thinking via memoryExtraParams", async () => {
    let capturedBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body ?? "{}"));
      return {
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: async () => "login fail",
      } as Response;
    }) as typeof fetch;

    const { provider } = makeProvider({
      extraParams: {
        thinking: { type: "adaptive" },
        model: "should-not-overwrite",
        messages: ["should-not-overwrite"],
        tools: ["should-not-overwrite"],
      },
    });
    await provider.executeToolCall("system", "user", toolSchema, "session-id");

    expect(capturedBody?.thinking).toEqual({ type: "adaptive" });
    expect(capturedBody?.model).toBe("MiniMax-M3");
    expect(Array.isArray(capturedBody?.messages)).toBe(true);
    expect(Array.isArray(capturedBody?.tools)).toBe(true);
  });

  it("keeps the recommended Flash model aligned in config templates", () => {
    const template = readFileSync(new URL("../src/config.ts", import.meta.url), "utf8");
    const example = readFileSync(new URL("../opencode-mem.example.jsonc", import.meta.url), "utf8");
    const modelPattern = /\/\/ MiniMax \(Anthropic[\s\S]*?"memoryModel": "([^"]+)"/;
    const memoryModel = template.match(modelPattern)?.[1];
    expect(memoryModel).toBe("MiniMax-M3.1-Flash");
    expect(example.match(modelPattern)?.[1]).toBe(memoryModel);
  });

  for (const apiUrl of [
    "https://api.minimax.io",
    "https://api.minimax.cn",
    "https://api.minimaxi.com",
  ]) {
    for (const effort of [undefined, "low", "medium", "high", "xhigh", "max"]) {
      it(`sends the recommended Flash configuration to ${apiUrl} with effort ${effort ?? "default"}`, async () => {
        const config = buildMemoryProviderConfig({
          memoryProvider: "minimax",
          memoryModel: "MiniMax-M3.1-Flash",
          memoryApiUrl: apiUrl,
          memoryApiKey: "fixture-only-key",
          memoryExtraParams: effort ? { output_config: { effort } } : undefined,
        });
        const provider = new MiniMaxProvider(config, new FakeSessionManager() as any);
        let body: any;
        let url: string | undefined;
        globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
          url = String(input);
          body = JSON.parse(String(init?.body));
          return Response.json({
            content: [
              {
                type: "tool_use",
                id: "tool_flash",
                name: "save_memories",
                input: { memory: "Flash fact" },
              },
            ],
            stop_reason: "tool_use",
          });
        }) as typeof fetch;
        const result = await provider.executeToolCall("system", "user", toolSchema, "session-id");
        expect(result.success).toBe(true);
        expect(url).toBe(`${apiUrl}/anthropic/v1/messages`);
        expect(body.model).toBe("MiniMax-M3.1-Flash");
        expect(body.output_config).toEqual(effort ? { effort } : undefined);
        expect(body.thinking).toBeUndefined();
        expect(body.service_tier).toBeUndefined();
        expect(body.tools[0].name).toBe("save_memories");
      });
    }
  }

  for (const model of ["MiniMax-M3", "MiniMax-M2.7", "custom-model"]) {
    it(`preserves the explicitly configured model ${model}`, async () => {
      let body: any;
      globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
        body = JSON.parse(String(init?.body));
        return Response.json({ content: [], stop_reason: "max_tokens" });
      }) as typeof fetch;
      const config = buildMemoryProviderConfig({
        memoryProvider: "minimax",
        memoryModel: model,
        memoryApiUrl: "https://custom.invalid",
        memoryApiKey: "fixture-only-key",
      });
      const provider = new MiniMaxProvider(config, new FakeSessionManager() as any);
      await provider.executeToolCall("system", "user", toolSchema, "session-id");
      expect(body.model).toBe(model);
      expect(body.thinking).toBeUndefined();
      expect(body.output_config).toBeUndefined();
    });
  }

  it("keeps explicit M3 disabled thinking unchanged", async () => {
    let body: any;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return Response.json({ content: [], stop_reason: "max_tokens" });
    }) as typeof fetch;
    const { provider } = makeProvider({ extraParams: { thinking: { type: "disabled" } } });
    await provider.executeToolCall("system", "user", toolSchema, "session-id");
    expect(body.model).toBe("MiniMax-M3");
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.output_config).toBeUndefined();
  });

  it("preserves complete Flash reasoning, tool results, and media history at the HTTP boundary", async () => {
    const sessionManager = new FakeSessionManager();
    const media = [
      { type: "image", source: { type: "url", url: "https://example.invalid/image.png" } },
      { type: "video", source: { type: "url", url: "https://example.invalid/video.mp4" } },
    ];
    const assistant = [
      { type: "thinking", thinking: "Keep this reasoning", signature: "fixture-signature" },
      { type: "text", text: "Remembering" },
      {
        type: "tool_use",
        id: "previous-tool",
        name: "save_memories",
        input: { memory: "prior fact" },
      },
    ];
    const toolResult = [{ type: "tool_result", tool_use_id: "previous-tool", content: "saved" }];
    sessionManager.addMessage({ role: "user", contentBlocks: media });
    sessionManager.addMessage({ role: "assistant", contentBlocks: assistant });
    sessionManager.addMessage({ role: "user", contentBlocks: toolResult });
    const responseContent = [
      { type: "thinking", thinking: "New reasoning", signature: "new-signature" },
      { type: "tool_use", id: "new-tool", name: "save_memories", input: { memory: "new fact" } },
    ];
    const bodies: any[] = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json({ content: responseContent, stop_reason: "tool_use" });
    }) as typeof fetch;
    const { provider } = makeProvider({ model: "MiniMax-M3.1-Flash" }, sessionManager);
    expect(
      (await provider.executeToolCall("system", "user", toolSchema, "session-id")).success
    ).toBe(true);
    expect(sessionManager.getMessages().at(-1).contentBlocks).toEqual(responseContent);
    await provider.executeToolCall("system", "next user", toolSchema, "session-id");
    expect(bodies[0].messages.slice(0, 3)).toEqual([
      { role: "user", content: media },
      { role: "assistant", content: assistant },
      { role: "user", content: toolResult },
    ]);
    expect(bodies[1].messages).toContainEqual({ role: "assistant", content: responseContent });
  });

  it("extracts tool input from a MiniMax Anthropic-format response", async () => {
    let capturedBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body ?? "{}"));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: "MiniMax-M3",
          stop_reason: "tool_use",
          content: [
            {
              type: "tool_use",
              id: "tool_1",
              name: "save_memories",
              input: { memory: "captured fact" },
            },
          ],
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      } as Response;
    }) as typeof fetch;

    const { provider } = makeProvider();
    const result = await provider.executeToolCall("system", "user", toolSchema, "session-id");

    expect(capturedBody?.model).toBe("MiniMax-M3");
    expect(capturedBody?.max_tokens).toBeDefined();
    expect(result.success).toBe(true);
    expect((result.data as any).memory).toBe("captured fact");
  });
});

describe("AIProviderFactory minimax wiring", () => {
  it("creates a MiniMax provider and lists it as supported", () => {
    const provider = AIProviderFactory.createProvider("minimax", {
      model: "MiniMax-M3",
      apiUrl: "https://api.minimax.io",
      apiKey: "test-key",
    });
    expect(provider.getProviderName()).toBe("minimax");
    expect(AIProviderFactory.getSupportedProviders()).toContain("minimax");
  });
});
