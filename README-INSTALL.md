# opencode-mem — local V2 build (portable)

> **Platform support: Windows 11 x64 only.**
> This fork is developed, packaged and verified on Windows 11 x64 with all four
> companion plugins (`opencode-elf`, `opencode-mem`, `openrtk`, `caveman`)
> enabled in the same OpenCode process. Linux and macOS are not supported.
> Co-install requires the pinned native dependency versions below.

A locally built copy of `opencode-mem` that includes the **OpenCode V2 plugin
API port**, which is not yet available in the published npm package.

| Field | Value |
| --- | --- |
| Upstream | https://github.com/tickernelz/opencode-mem |
| Branch | `main` |
| Commit | `cec1de4834567f9fca9970942712ab7559ede142` |
| Merged PR | #311 "feat: add OpenCode v2 plugin support" (`2026-09-19`) |
| `package.json` version | `2.26.0` (same string as the V1-only npm release) |
| OpenCode | v2 |

> **Heads-up:** the npm package `opencode-mem@2.26.0` is **V1-only**. This build
> is the same version string but from the Git branch that adds V2 support. Do
> not expect a version-number change to distinguish them.

---

## Requirements on the target machine

- **Windows 11 x64**
- **OpenCode v2** (`opencode --version`)
- **Node.js 20+ and npm** (used only to fetch dependencies)

You do **not** need `bun`. This bundle ships a prebuilt `dist/`, so the
upstream `bun`-based `prepare` script is never invoked (`build:local` /
`scripts/rebuild-local.mjs` drives TypeScript and Vite through npm instead).

---

## Native dependencies and co-install

Windows resolves native DLLs by **base name** and reuses the first module
already loaded in the process. When `opencode-mem` and `opencode-elf` run in
the same OpenCode process, both must ship the **same** native versions:

| Native dependency | Required version | Failure when mismatched |
| --- | --- | --- |
| `onnxruntime-node` | 1.20.1 | `LoadLibrary failed: The operating system cannot run %1.` (ERROR_INVALID_ORDINAL, 182) |
| `sharp` (libvips-42.dll) | 0.35.4 | `LoadLibrary failed: The specified procedure could not be found.` (ERROR_PROC_NOT_FOUND, 127) |

`package.json` pins both directly and via `overrides`. A system-wide
`onnxruntime.dll` in `C:\Windows\System32` (installed by Windows ML) can also
be picked up by the loader and cause the same failures.

---

## Install

### Windows (PowerShell)

```powershell
cd opencode-mem-bundle
powershell -ExecutionPolicy Bypass -File install.ps1
```

The installer:

1. Copies `dist/`, `index.ts`, and the manifests into
   `%USERPROFILE%\.config\opencode\plugins\opencode-mem\`.
2. Runs `npm install` there, which downloads the **platform-native** binaries
   (ONNX Runtime, libSQL, sharp, msgpackr) for the target OS/CPU.
3. Reminds you to add `"./plugins/opencode-mem"` to the `plugins` array in
   `opencode.jsonc`.

### Manual install (if you prefer)

```powershell
$CONFIG = "$env:USERPROFILE\.config\opencode"
New-Item -ItemType Directory -Force "$CONFIG\plugins\opencode-mem"
Copy-Item dist,index.ts,package.json,package-lock.json,README.md,LICENSE "$CONFIG\plugins\opencode-mem\" -Recurse
cd "$CONFIG\plugins\opencode-mem"
npm install --omit=dev --no-audit --no-fund
```

Then add the entry to `$CONFIG\opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    "./plugins/opencode-mem"
  ]
}
```

---

## Verify

```bash
opencode reload
opencode plugin list
# expect a row like:
#   opencode-mem  local  .../plugins/opencode-mem/index.ts
```

Then confirm the `memory` tool exists by asking an agent to run it, or open the
memory web UI at <http://127.0.0.1:4747> (HTTP 200 = running).

---

## Graceful degradation when embeddings are unavailable

When the embedding model cannot load, database-only modes keep working instead
of the `memory` tool failing as a whole:

- Working: `help`, `list`, `profile`, `forget`, `list-shards`, `migrate`, `export`
- Degraded (returns `embeddingsDegraded: true`): `add`, `search`, `import` — these need vectors

Verify with:

```bash
node --test tests/embedding-degradation.node.mjs
```

---

## Troubleshooting: `LoadLibrary failed: The operating system cannot run %1.`

This is a **native DLL base-name conflict**, not a broken package install:

1. Another plugin in the same OpenCode process already loaded a different
   `onnxruntime.dll` (or `libvips-42.dll`), and Windows reuses it by base name.
2. Or the loader picked the system copy in `C:\Windows\System32` (Windows ML).

Windows maps `%1` to error 182 (`ERROR_INVALID_ORDINAL`) when the reused DLL
lacks an imported ordinal, and to error 127 (`ERROR_PROC_NOT_FOUND`) for
missing procedures. Reinstalling `onnxruntime-node` does **not** fix it.

Fix: align the versions in the table above (update the other plugin, or remove
its older DLL), then restart OpenCode.

---

## Updating

This is a frozen local build. `opencode plugin check` / `update` **skip local
directories**, so it will not self-update.

When upstream publishes a release whose **npm tarball gains a `./v2` export**:

```bash
npm view opencode-mem exports --json   # look for a "./v2" key
```

...switch back to the maintained package:

1. Change the config entry from `"./plugins/opencode-mem"` to `"opencode-mem"`.
2. Delete `~/.config/opencode/plugins/opencode-mem/`.
3. Run `opencode plugin update`.

---

## Uninstall

1. Remove `"./plugins/opencode-mem"` from the `plugins` array in
   `opencode.jsonc`.
2. Delete `~/.config/opencode/plugins/opencode-mem/`.
3. `opencode reload`

---

## Rebuilding from source (optional)

```bash
git clone https://github.com/tickernelz/opencode-mem.git
cd opencode-mem
git checkout cec1de4834567f9fca9970942712ab7559ede142
npm install --no-audit --no-fund
node scripts/rebuild-local.mjs     # bun-free: tsc + vite build into dist/
```

`dist/` is gitignored. The root `index.ts` re-exports `dist/plugin.js` so the
checkout itself is a valid OpenCode plugin directory.
