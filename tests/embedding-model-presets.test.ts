import { describe, expect, it } from "bun:test";
import {
  getEmbeddingModelPreset,
  normalizeEmbeddingDtype,
  normalizeEmbeddingPooling,
} from "../src/config.js";

describe("getEmbeddingModelPreset", () => {
  it("returns mean pooling for nomic without forcing task prefixes", () => {
    expect(getEmbeddingModelPreset("Xenova/nomic-embed-text-v1")).toEqual({ pooling: "mean" });
  });

  it("returns cls pooling and empty prefixes for bge-m3", () => {
    expect(getEmbeddingModelPreset("Xenova/bge-m3")).toEqual({
      pooling: "cls",
      queryPrefix: "",
      documentPrefix: "",
    });
  });

  it("returns e5 query/passage prefixes", () => {
    expect(getEmbeddingModelPreset("intfloat/multilingual-e5-large")).toEqual({
      pooling: "mean",
      queryPrefix: "query: ",
      documentPrefix: "passage: ",
    });
    expect(getEmbeddingModelPreset("intfloat/e5-large-v2")?.queryPrefix).toBe("query: ");
  });

  it("returns last_token pooling and instruct query prefix for Qwen3-Embedding", () => {
    const preset = getEmbeddingModelPreset("onnx-community/Qwen3-Embedding-0.6B-ONNX");
    expect(preset?.pooling).toBe("last_token");
    expect(preset?.documentPrefix).toBe("");
    expect(preset?.queryPrefix).toContain("Instruct:");
    expect(preset?.queryPrefix).toContain("Query: ");
  });

  it("returns mean pooling and empty prefixes for jina", () => {
    expect(getEmbeddingModelPreset("Xenova/jina-embeddings-v2-base-en")).toEqual({
      pooling: "mean",
      queryPrefix: "",
      documentPrefix: "",
    });
  });

  it("returns undefined for unknown models", () => {
    expect(getEmbeddingModelPreset("Xenova/all-MiniLM-L6-v2")).toBeUndefined();
  });
});

describe("normalizeEmbeddingPooling", () => {
  it("accepts mean, cls, and last_token", () => {
    expect(normalizeEmbeddingPooling("mean")).toBe("mean");
    expect(normalizeEmbeddingPooling("cls")).toBe("cls");
    expect(normalizeEmbeddingPooling("last_token")).toBe("last_token");
  });

  it("rejects invalid values", () => {
    expect(() => normalizeEmbeddingPooling("max")).toThrow(/embeddingPooling/);
    expect(() => normalizeEmbeddingPooling(1)).toThrow(/embeddingPooling/);
  });
});

describe("normalizeEmbeddingDtype", () => {
  it("accepts known transformers.js dtypes and trims whitespace", () => {
    expect(normalizeEmbeddingDtype("q8")).toBe("q8");
    expect(normalizeEmbeddingDtype(" fp32 ")).toBe("fp32");
    expect(normalizeEmbeddingDtype("")).toBeUndefined();
    expect(normalizeEmbeddingDtype(undefined)).toBeUndefined();
  });

  it("rejects unknown dtypes", () => {
    expect(() => normalizeEmbeddingDtype("bfloat16")).toThrow(/embeddingDtype/);
  });
});
