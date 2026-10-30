import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAutoCaptureConfigReminderMessage } from "../src/services/auto-capture-config-status.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("buildAutoCaptureConfigReminderMessage", () => {
  it("mentions config keys and includes issues", () => {
    const message = buildAutoCaptureConfigReminderMessage([
      "opencodeProvider is not configured",
      "opencodeModel is not configured",
    ]);
    expect(message).toContain("opencodeProvider + opencodeModel");
    expect(message).toContain("autoCaptureEnabled: false");
    expect(message).toContain("opencodeProvider is not configured");
    expect(message).toContain("opencodeModel is not configured");
  });
});

describe("notifyAutoCaptureProviderStatus", () => {
  const statusUrl = new URL("../src/services/auto-capture-config-status.js", import.meta.url).href;
  const configUrl = new URL("../src/config.js", import.meta.url).href;
  const loggerUrl = new URL("../src/services/logger.js", import.meta.url).href;

  function runScenario(opts: {
    autoCaptureEnabled: boolean;
    ready: boolean;
    issues?: string[];
    showErrorToasts: boolean;
    withToastClient: boolean;
  }) {
    const dir = mkdtempSync(join(tmpdir(), "opencode-mem-capture-toast-"));
    tempDirs.push(dir);
    const scriptPath = join(dir, "scenario.mjs");
    const script = `
import { mock } from "bun:test";

const logs = [];
const toasts = [];

mock.module(${JSON.stringify(configUrl)}, () => ({
  CONFIG: {
    autoCaptureEnabled: ${JSON.stringify(opts.autoCaptureEnabled)},
    showErrorToasts: ${JSON.stringify(opts.showErrorToasts)},
    autoCaptureProviderStatus: ${JSON.stringify(
      opts.ready
        ? { ready: true, mode: "opencode", issues: [] }
        : { ready: false, issues: opts.issues ?? ["opencodeProvider is not configured"] }
    )},
  },
}));

mock.module(${JSON.stringify(loggerUrl)}, () => ({
  log: (message) => logs.push(message),
  safeLog: () => {},
}));

const { notifyAutoCaptureProviderStatus } = await import(${JSON.stringify(statusUrl)});

const client = ${
      opts.withToastClient
        ? `{
  tui: {
    showToast: async (input) => {
      toasts.push(input);
      return {};
    },
  },
}`
        : "undefined"
    };

notifyAutoCaptureProviderStatus(client);
await new Promise((r) => setTimeout(r, 10));

console.log(JSON.stringify({ logs, toasts }));
`;
    writeFileSync(scriptPath, script);
    const proc = Bun.spawnSync(["bun", "run", scriptPath], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (proc.exitCode !== 0) {
      throw new Error(`scenario failed: ${proc.stderr.toString() || proc.stdout.toString()}`);
    }
    return JSON.parse(proc.stdout.toString()) as {
      logs: string[];
      toasts: Array<{ body: { title: string; message: string; variant: string } }>;
    };
  }

  it("toasts and logs when auto-capture is on without a provider", () => {
    const result = runScenario({
      autoCaptureEnabled: true,
      ready: false,
      issues: ["opencodeProvider is not configured", "opencodeModel is not configured"],
      showErrorToasts: true,
      withToastClient: true,
    });
    expect(result.logs.some((m) => m.includes("Auto-capture disabled by configuration"))).toBe(
      true
    );
    expect(result.toasts).toHaveLength(1);
    expect(result.toasts[0]?.body.title).toBe("Auto-Capture");
    expect(result.toasts[0]?.body.variant).toBe("warning");
    expect(result.toasts[0]?.body.message).toContain("opencodeProvider + opencodeModel");
  });

  it("skips toast when showErrorToasts is false but still logs", () => {
    const result = runScenario({
      autoCaptureEnabled: true,
      ready: false,
      showErrorToasts: false,
      withToastClient: true,
    });
    expect(result.logs.length).toBeGreaterThan(0);
    expect(result.toasts).toHaveLength(0);
  });

  it("does nothing when provider status is ready", () => {
    const result = runScenario({
      autoCaptureEnabled: true,
      ready: true,
      showErrorToasts: true,
      withToastClient: true,
    });
    expect(result.logs).toHaveLength(0);
    expect(result.toasts).toHaveLength(0);
  });

  it("does nothing when auto-capture is disabled", () => {
    const result = runScenario({
      autoCaptureEnabled: false,
      ready: false,
      showErrorToasts: true,
      withToastClient: true,
    });
    expect(result.logs).toHaveLength(0);
    expect(result.toasts).toHaveLength(0);
  });
});
