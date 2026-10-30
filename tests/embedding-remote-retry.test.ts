import { describe, it, expect } from "bun:test";
import { fetchRemoteEmbeddingWithRetry, EmbeddingHttpError } from "../src/services/embedding.js";

function jsonResponse(status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: async () => ({ data: [{ embedding: [0.1, 0.2] }] }),
  } as unknown as Response;
}

const RETRY_OPTS = {
  url: "https://fake.local/v1",
  apiKey: "test-key",
  model: "test-model",
  attemptTimeoutMs: 50,
  maxAttempts: 3,
  backoffMs: 5,
};

describe("fetchRemoteEmbeddingWithRetry", () => {
  it("recovers when the first attempt hangs past the per-attempt AbortSignal timeout", async () => {
    let calls = 0;
    const fetchImpl = async (_url: unknown, init?: { signal?: AbortSignal }) => {
      calls++;
      if (calls === 1) {
        expect(init?.signal).toBeDefined();
        await new Promise<never>((_resolve, reject) => {
          const signal = init!.signal!;
          if (signal.aborted) {
            reject(signal.reason ?? new DOMException("The operation was aborted.", "TimeoutError"));
            return;
          }
          signal.addEventListener(
            "abort",
            () => {
              reject(
                signal.reason ?? new DOMException("The operation was aborted.", "TimeoutError")
              );
            },
            { once: true }
          );
        });
      }
      return jsonResponse(200);
    };
    const data = await fetchRemoteEmbeddingWithRetry(
      fetchImpl as unknown as typeof fetch,
      "hello",
      RETRY_OPTS
    );
    expect(data.data[0].embedding).toEqual([0.1, 0.2]);
    expect(calls).toBe(2);
  });

  it("retries on network TypeError and succeeds on a later attempt", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      if (calls === 1) throw new TypeError("fetch failed");
      return jsonResponse(200);
    };
    const data = await fetchRemoteEmbeddingWithRetry(
      fetchImpl as unknown as typeof fetch,
      "hello",
      RETRY_OPTS
    );
    expect(data.data[0].embedding).toEqual([0.1, 0.2]);
    expect(calls).toBe(2);
  });

  it("fails fast on invalid JSON without consuming another attempt", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => {
          throw new SyntaxError("Unexpected token");
        },
      } as unknown as Response;
    };
    await expect(
      fetchRemoteEmbeddingWithRetry(fetchImpl as unknown as typeof fetch, "hello", RETRY_OPTS)
    ).rejects.toThrow("Invalid embedding API JSON");
    expect(calls).toBe(1);
  });

  it("passes AbortSignal.timeout to each fetch attempt", async () => {
    let seenSignal: AbortSignal | undefined;
    const fetchImpl = async (_url: unknown, init?: { signal?: AbortSignal }) => {
      seenSignal = init?.signal;
      return jsonResponse(200);
    };
    await fetchRemoteEmbeddingWithRetry(fetchImpl as unknown as typeof fetch, "hello", RETRY_OPTS);
    expect(seenSignal).toBeDefined();
    expect(typeof seenSignal!.aborted).toBe("boolean");
  });

  it("retries on 429 and succeeds on a later attempt", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      return calls === 1 ? jsonResponse(429) : jsonResponse(200);
    };
    const data = await fetchRemoteEmbeddingWithRetry(
      fetchImpl as unknown as typeof fetch,
      "hello",
      RETRY_OPTS
    );
    expect(data.data[0].embedding).toEqual([0.1, 0.2]);
    expect(calls).toBe(2);
  });

  it("retries on 500 and succeeds on a later attempt", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      return calls === 1 ? jsonResponse(500) : jsonResponse(200);
    };
    await fetchRemoteEmbeddingWithRetry(fetchImpl as unknown as typeof fetch, "hello", RETRY_OPTS);
    expect(calls).toBe(2);
  });

  it("fails fast on non-retryable 4xx without consuming another attempt", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      return jsonResponse(401);
    };
    await expect(
      fetchRemoteEmbeddingWithRetry(fetchImpl as unknown as typeof fetch, "hello", RETRY_OPTS)
    ).rejects.toBeInstanceOf(EmbeddingHttpError);
    expect(calls).toBe(1);
  });

  it("throws the last error after exhausting all attempts on persistent 5xx", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      return jsonResponse(503);
    };
    await expect(
      fetchRemoteEmbeddingWithRetry(fetchImpl as unknown as typeof fetch, "hello", RETRY_OPTS)
    ).rejects.toBeInstanceOf(EmbeddingHttpError);
    expect(calls).toBe(3);
  });

  it("preserves the request shape: base url, bearer auth, prefixed input, model", async () => {
    let seen: { url: string; auth: string | undefined; body: any } | null = null;
    const fetchImpl = async (url: unknown, init?: { headers?: Record<string, string> }) => {
      seen = {
        url: String(url),
        auth: init?.headers?.["Authorization"],
        body: JSON.parse(String(init?.body)),
      };
      return jsonResponse(200);
    };
    await fetchRemoteEmbeddingWithRetry(
      fetchImpl as unknown as typeof fetch,
      "search_query: hello",
      RETRY_OPTS
    );
    expect(seen).not.toBeNull();
    expect(seen!.url).toBe("https://fake.local/v1/embeddings");
    expect(seen!.auth).toBe("Bearer test-key");
    expect(seen!.body.input).toBe("search_query: hello");
    expect(seen!.body.model).toBe("test-model");
  });
});
