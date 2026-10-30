import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

function readPackageJson(): Record<string, any> {
  return JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as Record<
    string,
    any
  >;
}

describe("OpenCode v2 plugin-loader contract", () => {
  it("publishes the native v2 entrypoint", () => {
    const pkg = readPackageJson();
    expect(pkg.exports?.["./v2"]).toEqual({
      import: "./dist/v2/plugin.js",
      types: "./dist/v2/plugin.d.ts",
    });
    expect(pkg.files).toContain("dist");
  });

  it("publishes the TUI companion entrypoint", () => {
    const pkg = readPackageJson();
    expect(pkg.exports?.["./tui"]).toEqual({
      import: "./dist/tui.js",
      types: "./dist/tui.d.ts",
    });
  });

  it("exports a native v2 plugin definition", async () => {
    const mod = await import(new URL("../dist/v2/plugin.js", import.meta.url).href);
    expect(mod.default.id).toBe("opencode-mem");
    expect(typeof mod.default.setup).toBe("function");
  });

  it("exports a TUI companion plugin definition", async () => {
    const mod = await import(new URL("../dist/tui.js", import.meta.url).href);
    expect(mod.default.id).toBe("opencode-mem-tui");
    expect(typeof mod.default.setup).toBe("function");
  });

  it("exposes V1 and V2 from the installable package entrypoint", async () => {
    const mod = await import(new URL("../dist/plugin.js", import.meta.url).href);
    expect(mod.default.id).toBe("opencode-mem");
    expect(typeof mod.default.server).toBe("function");
    expect(typeof mod.default.setup).toBe("function");
  });
});
