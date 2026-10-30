import { afterEach, describe, expect, it } from "bun:test";
import {
  OpenAIChatCompletionProvider,
  isStreamRequiredError,
  parseChatCompletionStream,
} from "../src/services/ai/providers/openai-chat-completion.js";
import type { AIMessage } from "../src/services/ai/session/session-types.js";
import type { ChatCompletionTool } from "../src/services/ai/tools/tool-schema.js";

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

  getSession(): any {
    return null;
  }

  createSession(): any {
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

class TestableOpenAIChatCompletionProvider extends OpenAIChatCompletionProvider {
  filterMessages(messages: AIMessage[]): AIMessage[] {
    return this.filterIncompleteToolCallSequences(messages);
  }
}

function makeProvider(config: Record<string, unknown> = {}) {
  return new OpenAIChatCompletionProvider(
    { model: "gpt-4o-mini", apiKey: "test-key", ...config },
    new FakeSessionManager() as any
  );
}

function makeTestableProvider(config: Record<string, unknown> = {}) {
  return new TestableOpenAIChatCompletionProvider(
    { model: "gpt-4o-mini", apiKey: "test-key", ...config },
    new FakeSessionManager() as any
  );
}

function makeFetch(response: {
  ok?: boolean;
  status?: number;
  statusText?: string;
  body?: unknown;
}) {
  const textBody =
    typeof response.body === "string" ? response.body : JSON.stringify(response.body ?? "error");
  const jsonBody = typeof response.body === "string" ? {} : (response.body ?? {});
  return (async (_input: RequestInfo | URL, _init?: RequestInit) => {
    return {
      ok: response.ok ?? false,
      status: response.status ?? 400,
      statusText: response.statusText ?? "Bad Request",
      text: async () => textBody,
      json: async () => jsonBody,
    } as Response;
  }) as typeof fetch;
}

describe("OpenAIChatCompletionProvider", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("getProviderName returns openai-chat", () => {
    expect(makeProvider().getProviderName()).toBe("openai-chat");
  });

  it("supportsSession returns true", () => {
    expect(makeProvider().supportsSession()).toBe(true);
  });

  it("keeps complete tool call sequences", () => {
    const messages: AIMessage[] = [
      {
        aiSessionId: "session-1",
        sequence: 0,
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "call-1",
            type: "function",
            function: { name: "save_memories", arguments: "{}" },
          },
        ],
        createdAt: 1,
      },
      {
        aiSessionId: "session-1",
        sequence: 1,
        role: "tool",
        content: '{"success":true}',
        toolCallId: "call-1",
        createdAt: 2,
      },
    ];

    expect(makeTestableProvider().filterMessages(messages)).toEqual(messages);
  });

  it("drops trailing incomplete tool call sequences", () => {
    const messages: AIMessage[] = [
      {
        aiSessionId: "session-1",
        sequence: 0,
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "call-1",
            type: "function",
            function: { name: "save_memories", arguments: "{}" },
          },
        ],
        createdAt: 1,
      },
    ];

    expect(makeTestableProvider().filterMessages(messages)).toEqual([]);
  });

  it("keeps complete prefix and drops later incomplete tool call sequences", () => {
    const messages: AIMessage[] = [
      {
        aiSessionId: "session-1",
        sequence: 0,
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "call-1",
            type: "function",
            function: { name: "save_memories", arguments: "{}" },
          },
        ],
        createdAt: 1,
      },
      {
        aiSessionId: "session-1",
        sequence: 1,
        role: "tool",
        content: '{"success":true}',
        toolCallId: "call-1",
        createdAt: 2,
      },
      {
        aiSessionId: "session-1",
        sequence: 2,
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "call-2",
            type: "function",
            function: { name: "save_memories", arguments: "{}" },
          },
        ],
        createdAt: 3,
      },
    ];

    expect(makeTestableProvider().filterMessages(messages)).toEqual(messages.slice(0, 2));
  });

  it("uses custom apiUrl for the request", async () => {
    let capturedUrl = "";
    globalThis.fetch = (async (input: RequestInfo | URL, _init?: RequestInit) => {
      capturedUrl = String(input);
      return { ok: false, status: 400, statusText: "Bad", text: async () => "err" } as Response;
    }) as typeof fetch;

    await makeProvider({ apiUrl: "https://compatible.example.com/v1" }).executeToolCall(
      "system",
      "user",
      toolSchema,
      "session-id"
    );

    expect(capturedUrl).toBe("https://compatible.example.com/v1/chat/completions");
  });

  it("sends Authorization Bearer header", async () => {
    let capturedHeaders: Record<string, string> | undefined;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return { ok: false, status: 400, statusText: "Bad", text: async () => "err" } as Response;
    }) as typeof fetch;

    await makeProvider({ apiKey: "sk-mykey", apiUrl: "https://api.openai.com/v1" }).executeToolCall(
      "system",
      "user",
      toolSchema,
      "session-id"
    );

    expect(capturedHeaders?.Authorization).toBe("Bearer sk-mykey");
  });

  it("omits Authorization header when apiKey is not set", async () => {
    let capturedHeaders: Record<string, string> | undefined;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return { ok: false, status: 400, statusText: "Bad", text: async () => "err" } as Response;
    }) as typeof fetch;

    await makeProvider({ apiKey: undefined, apiUrl: "https://api.openai.com/v1" }).executeToolCall(
      "system",
      "user",
      toolSchema,
      "session-id"
    );

    expect(capturedHeaders?.Authorization).toBeUndefined();
  });

  it("sends model, messages, tools, tool_choice in request body", async () => {
    let capturedBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body ?? "{}"));
      return { ok: false, status: 400, statusText: "Bad", text: async () => "err" } as Response;
    }) as typeof fetch;

    await makeProvider({
      model: "gpt-4o-mini",
      apiUrl: "https://api.openai.com/v1",
    }).executeToolCall("system", "user", toolSchema, "session-id");

    expect(capturedBody?.model).toBe("gpt-4o-mini");
    expect(Array.isArray(capturedBody?.messages)).toBe(true);
    expect(Array.isArray(capturedBody?.tools)).toBe(true);
    expect(capturedBody?.tool_choice).toBe("required");
  });

  it("includes temperature 0.3 by default", async () => {
    let capturedBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body ?? "{}"));
      return { ok: false, status: 400, statusText: "Bad", text: async () => "err" } as Response;
    }) as typeof fetch;

    await makeProvider({ apiUrl: "https://api.openai.com/v1" }).executeToolCall(
      "system",
      "user",
      toolSchema,
      "session-id"
    );

    expect(capturedBody?.temperature).toBe(0.3);
  });

  it("omits temperature when memoryTemperature is false", async () => {
    let capturedBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body ?? "{}"));
      return { ok: false, status: 400, statusText: "Bad", text: async () => "err" } as Response;
    }) as typeof fetch;

    await makeProvider({
      memoryTemperature: false,
      apiUrl: "https://api.openai.com/v1",
    }).executeToolCall("system", "user", toolSchema, "session-id");

    expect(capturedBody?.temperature).toBeUndefined();
  });

  it("returns success: false with error message on API error response", async () => {
    globalThis.fetch = makeFetch({ ok: false, status: 401, body: "Unauthorized" });

    const result = await makeProvider({ apiUrl: "https://api.openai.com/v1" }).executeToolCall(
      "system",
      "user",
      toolSchema,
      "session-id"
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("401");
  });

  it("returns friendly message on temperature unsupported error", async () => {
    globalThis.fetch = makeFetch({
      ok: false,
      status: 400,
      body: '{"error": {"type": "unsupported_value", "param": "temperature"}}',
    });

    const result = await makeProvider({ apiUrl: "https://api.openai.com/v1" }).executeToolCall(
      "system",
      "user",
      toolSchema,
      "session-id"
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("memoryTemperature");
  });

  it("returns friendly message when thinking mode rejects tool_choice required", async () => {
    globalThis.fetch = makeFetch({
      ok: false,
      status: 400,
      body: "Thinking mode does not support this tool_choice",
    });

    const result = await makeProvider({ apiUrl: "https://api.openai.com/v1" }).executeToolCall(
      "system",
      "user",
      toolSchema,
      "session-id"
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("forceToolChoice");
    expect(result.error).toContain("false");
  });

  it("returns success: false when response has no choices", async () => {
    globalThis.fetch = makeFetch({ ok: true, body: { choices: [] } } as any);

    const result = await makeProvider({ apiUrl: "https://api.openai.com/v1" }).executeToolCall(
      "system",
      "user",
      toolSchema,
      "session-id"
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid API response format");
  });

  it("returns success: false when API returns error in response body", async () => {
    globalThis.fetch = makeFetch({
      ok: true,
      body: { status: "error", msg: "quota exceeded" },
    } as any);

    const result = await makeProvider({ apiUrl: "https://api.openai.com/v1" }).executeToolCall(
      "system",
      "user",
      toolSchema,
      "session-id"
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("quota exceeded");
  });

  it("returns success: true when model calls the correct tool", async () => {
    const validArguments = JSON.stringify({
      preferences: [],
      patterns: [],
      workflows: [],
      codingStyle: {},
      domainKnowledge: [],
    });

    globalThis.fetch = makeFetch({
      ok: true,
      body: {
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: "call-1",
                  type: "function",
                  function: { name: "save_memories", arguments: validArguments },
                },
              ],
            },
          },
        ],
      },
    } as any);

    const result = await makeProvider({ apiUrl: "https://api.openai.com/v1" }).executeToolCall(
      "system",
      "user",
      toolSchema,
      "session-id"
    );

    expect(result.success).toBe(true);
    expect(result.iterations).toBe(1);
  });

  it("retries after tool-argument validation failure and succeeds on next attempt", async () => {
    const invalidArguments = JSON.stringify({
      preferences: [],
      patterns: [],
      workflows: "none",
    });
    const validArguments = JSON.stringify({
      preferences: [],
      patterns: [],
      workflows: [],
      codingStyle: {},
      domainKnowledge: [],
    });

    const responses = [
      {
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: "call-1",
                  type: "function",
                  function: { name: "save_memories", arguments: invalidArguments },
                },
              ],
            },
          },
        ],
      },
      {
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: "call-2",
                  type: "function",
                  function: { name: "save_memories", arguments: validArguments },
                },
              ],
            },
          },
        ],
      },
    ];

    let callCount = 0;
    const requestBodies: Array<{ messages?: Array<{ role?: string; content?: string }> }> = [];

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      requestBodies.push(body);
      const responseBody = responses[callCount] ?? responses[responses.length - 1];
      callCount++;
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => JSON.stringify(responseBody),
        json: async () => responseBody,
      } as Response;
    }) as typeof fetch;

    const result = await makeProvider({
      maxIterations: 3,
      apiUrl: "https://api.openai.com/v1",
    }).executeToolCall("system", "user", toolSchema, "session-id");

    expect(result.success).toBe(true);
    expect(result.iterations).toBe(2);
    expect(callCount).toBe(2);

    const secondMessages = requestBodies[1]?.messages ?? [];
    const retryFeedback = secondMessages.some(
      (msg) =>
        typeof msg.content === "string" &&
        (msg.content.includes("Validation failed") ||
          msg.content.includes("workflows must be an array"))
    );
    expect(retryFeedback).toBe(true);
  });

  it("returns success: false after max iterations with no tool call", async () => {
    globalThis.fetch = makeFetch({
      ok: true,
      body: {
        choices: [{ message: { content: "I will not use a tool", tool_calls: undefined } }],
      },
    } as any);

    const result = await makeProvider({
      maxIterations: 2,
      apiUrl: "https://api.openai.com/v1",
    }).executeToolCall("system", "user", toolSchema, "session-id");

    expect(result.success).toBe(false);
    expect(result.error).toContain("Max iterations");
    expect(result.iterations).toBe(2);
  });

  it("returns success: false when model calls wrong tool name", async () => {
    globalThis.fetch = makeFetch({
      ok: true,
      body: {
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: "call-1",
                  type: "function",
                  function: { name: "wrong_tool", arguments: "{}" },
                },
              ],
            },
          },
        ],
      },
    } as any);

    const result = await makeProvider({
      maxIterations: 1,
      apiUrl: "https://api.openai.com/v1",
    }).executeToolCall("system", "user", toolSchema, "session-id");

    expect(result.success).toBe(false);
  });

  it("defaults to tool_choice=required so models cannot answer with prose", async () => {
    let sentBody: any;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      sentBody = JSON.parse(String(init?.body));
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => "",
        json: async () => ({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: "call-1",
                    type: "function",
                    function: { name: "save_memories", arguments: "{}" },
                  },
                ],
              },
            },
          ],
        }),
      } as Response;
    }) as typeof fetch;

    await makeProvider({ apiUrl: "https://api.openai.com/v1" }).executeToolCall(
      "system",
      "user",
      toolSchema,
      "session-id"
    );

    expect(sentBody.tool_choice).toBe("required");
  });

  it("honors forceToolChoice=false to fall back to tool_choice=auto", async () => {
    let sentBody: any;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      sentBody = JSON.parse(String(init?.body));
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => "",
        json: async () => ({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: "call-1",
                    type: "function",
                    function: { name: "save_memories", arguments: "{}" },
                  },
                ],
              },
            },
          ],
        }),
      } as Response;
    }) as typeof fetch;

    await makeProvider({
      apiUrl: "https://api.openai.com/v1",
      forceToolChoice: false,
    }).executeToolCall("system", "user", toolSchema, "session-id");

    expect(sentBody.tool_choice).toBe("auto");
  });

  it("detects non-stream-required API errors", () => {
    expect(isStreamRequiredError(400, "Non-stream chat request is currently not supported")).toBe(
      true
    );
    expect(isStreamRequiredError(400, "endpoint only supports streaming")).toBe(true);
    expect(isStreamRequiredError(400, "unsupported_value temperature")).toBe(false);
    expect(isStreamRequiredError(401, "Non-stream chat request is currently not supported")).toBe(
      false
    );
  });

  it("parses SSE tool-call deltas into a non-streaming response shape", async () => {
    const validArguments = JSON.stringify({
      preferences: [],
      patterns: [],
      workflows: [],
      codingStyle: {},
      domainKnowledge: [],
    });
    const sse = [
      `data: ${JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call-1",
                  type: "function",
                  function: { name: "save_memories", arguments: "" },
                },
              ],
            },
          },
        ],
      })}`,
      `data: ${JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, function: { arguments: validArguments.slice(0, 20) } }],
            },
          },
        ],
      })}`,
      `data: ${JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, function: { arguments: validArguments.slice(20) } }],
            },
          },
        ],
      })}`,
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] })}`,
      "data: [DONE]",
    ].join("\n");

    const parsed = (await parseChatCompletionStream({
      text: async () => sse,
    } as Response)) as {
      choices: Array<{ message: { tool_calls?: Array<{ function: { arguments: string } }> } }>;
    };

    expect(parsed.choices[0]?.message.tool_calls?.[0]?.function.arguments).toBe(validArguments);
  });

  it("retries with stream:true when non-streaming chat is rejected", async () => {
    const validArguments = JSON.stringify({
      preferences: [],
      patterns: [],
      workflows: [],
      codingStyle: {},
      domainKnowledge: [],
    });
    const requestBodies: Array<Record<string, unknown>> = [];
    const sse = [
      `data: ${JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call-1",
                  type: "function",
                  function: { name: "save_memories", arguments: validArguments },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      })}`,
      "data: [DONE]",
    ].join("\n");

    let callCount = 0;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      requestBodies.push(body);
      callCount++;
      if (callCount === 1) {
        return {
          ok: false,
          status: 400,
          statusText: "Bad Request",
          text: async () => "Non-stream chat request is currently not supported",
          json: async () => ({}),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => sse,
        json: async () => {
          throw new Error("streaming response has no JSON body");
        },
      } as Response;
    }) as typeof fetch;

    const result = await makeProvider({ apiUrl: "https://api.example.com/v1" }).executeToolCall(
      "system",
      "user",
      toolSchema,
      "session-id"
    );

    expect(result.success).toBe(true);
    expect(callCount).toBe(2);
    expect(requestBodies[0]?.stream).toBeUndefined();
    expect(requestBodies[1]?.stream).toBe(true);
  });
});
