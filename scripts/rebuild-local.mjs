// Rebuild this checkout into a loadable local OpenCode plugin.
//
// The package's build script uses `bun`, which is not required here: this
// script drives the same TypeScript and Vite steps through npm so a checkout
// can be rebuilt with only Node.js available.
//
//   node scripts/rebuild-local.mjs            # full rebuild
//   node scripts/rebuild-local.mjs --skip-deps  # skip npm install
//   node scripts/rebuild-local.mjs --check      # typecheck only, no output
//
// Produces:
//   dist/       compiled server code (includes dist/v2/plugin.js)
//   dist/web/   built memory web UI
//
// dist/ is gitignored. index.ts at the repository root re-exports dist/plugin.js
// so the checkout itself is a valid OpenCode plugin directory.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const skipDeps = args.has("--skip-deps");
const checkOnly = args.has("--check");

const isWindows = process.platform === "win32";

/**
 * Resolve an npm-installed CLI to its JS entrypoint.
 *
 * The npm/npx launchers are `.cmd` shims on Windows, which Node refuses to spawn
 * without a shell. Invoking the underlying JS avoids that entirely, so no shell
 * is needed and arguments stay safely separated on every platform.
 *
 * The entry file name varies by package (typescript -> bin/tsc, vite ->
 * bin/vite.js), so read each package's own `bin` field rather than guessing.
 */
function cliBin(pkgName, commandName, cwd = ROOT) {
  const pkgDir = join(cwd, "node_modules", ...pkgName.split("/"));
  const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
  const binField = pkg.bin;
  const entry =
    typeof binField === "string"
      ? binField
      : binField?.[commandName] ?? binField?.[pkgName.split("/").pop()];
  assert.ok(entry, `cannot resolve "${commandName}" entrypoint in ${pkgName}`);
  return join(pkgDir, entry);
}

/** Run the current Node binary against a script, failing on a non-zero exit. */
function run(args, cwd, label = args.join(" ")) {
  console.log(`\n$ ${label}`);
  const result = spawnSync(process.execPath, args, { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `command failed (${result.status}): ${label}`);
}

const npmCli = process.env.npm_execpath && process.env.npm_execpath.endsWith(".js")
  ? process.env.npm_execpath
  : undefined;

/** Run `npm <args>` via its JS entrypoint when known, otherwise the bare binary. */
function runNpm(args, cwd) {
  if (npmCli) return run([npmCli, ...args], cwd, `npm ${args.join(" ")}`);
  console.log(`\n$ npm ${args.join(" ")}`);
  const result = spawnSync(isWindows ? "npm.cmd" : "npm", args, {
    cwd,
    stdio: "inherit",
    shell: isWindows,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `npm failed (${result.status})`);
}

function step(message) {
  console.log(`\n=== ${message} ===`);
}

// 1. Dependencies. --ignore-scripts skips the upstream `prepare` hook, which
//    shells out to husky/bun and is irrelevant to a built artifact.
if (!skipDeps) {
  step("Installing dependencies");
  if (!existsSync(join(ROOT, "node_modules"))) {
    runNpm(["install", "--ignore-scripts", "--no-audit", "--no-fund"], ROOT);
  } else {
    console.log("root node_modules present, skipping (pass no --skip-deps to reinstall)");
  }
  if (!existsSync(join(ROOT, "web", "node_modules"))) {
    runNpm(["install", "--ignore-scripts", "--no-audit", "--no-fund"], join(ROOT, "web"));
  } else {
    console.log("web node_modules present, skipping");
  }
}

// 2. Server code. `tsc` reads tsconfig.json and writes dist/.
step(checkOnly ? "Typechecking server code" : "Building server code");
run(
  [cliBin("typescript", "tsc"), checkOnly ? "--noEmit" : ""].filter(Boolean),
  ROOT,
  checkOnly ? "tsc --noEmit" : "tsc"
);

if (checkOnly) {
  console.log("\nTypecheck complete. No output written.");
  process.exit(0);
}

// 3. Web UI. Force a clean output so stale hashed asset names cannot linger.
step("Building web UI");
const webDist = join(ROOT, "dist", "web");
if (existsSync(webDist)) rmSync(webDist, { recursive: true, force: true });
const web = join(ROOT, "web");
run([cliBin("typescript", "tsc", web), "-b"], web, "tsc -b (web)");
run([cliBin("vite", "vite", web), "build"], web, "vite build (web)");

// 4. Verify the artifacts a plugin host needs.
step("Verifying build output");
const required = [
  join(ROOT, "dist", "plugin.js"),
  join(ROOT, "dist", "v2", "plugin.js"),
  join(ROOT, "dist", "web", "index.html"),
  join(ROOT, "index.ts"),
];
for (const path of required) {
  assert.ok(existsSync(path), `missing expected artifact: ${path}`);
  console.log(`ok  ${path.slice(ROOT.length + 1)}`);
}

const plugin = (await import(`file://${join(ROOT, "dist", "plugin.js")}`)).default;
assert.equal(plugin.id, "opencode-mem", "plugin id must be opencode-mem");
assert.equal(typeof plugin.setup, "function", "V2 setup export must be callable");
assert.equal(typeof plugin.server, "function", "V1 server export must be callable");
console.log("ok  default export exposes id, setup (V2), server (V1)");

console.log("\nRebuild complete. Reload OpenCode to pick up the change:");
console.log("  opencode reload");
