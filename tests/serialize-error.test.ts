import { describe, expect, it } from "bun:test";
import { serializeError } from "../src/services/logger.js";

describe("serializeError", () => {
  it("includes message, name, and stack for Error instances", () => {
    const err = new Error("timed out");
    const serialized = serializeError(err);
    expect(serialized.error).toBe("timed out");
    expect(serialized.name).toBe("Error");
    expect(serialized.stack).toContain("timed out");
  });

  it("includes cause message when present", () => {
    const cause = new Error("db busy");
    const err = new Error("Memory persistence failed", { cause });
    const serialized = serializeError(err);
    expect(serialized.cause).toBe("db busy");
  });

  it("stringifies non-Error values", () => {
    expect(serializeError("plain")).toEqual({ error: "plain" });
  });
});
