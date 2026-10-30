/**
 * Process-wide lease count for live plugin instances. OpenCode Desktop hosts
 * several sessions in one process; each session loads its own plugin instance.
 * Disposing one must not close the shared Turso pool while others are alive
 * (#443).
 *
 * Kept free of manager imports so `index.ts` can retain without pulling the
 * full Turso lifecycle graph at module load.
 */
const PLUGIN_TURSO_REFS_KEY = Symbol.for("opencode-mem.plugin.tursoRefs");

type PluginTursoRefs = { count: number };

function pluginTursoRefs(): PluginTursoRefs {
  const g = globalThis as typeof globalThis & {
    [PLUGIN_TURSO_REFS_KEY]?: PluginTursoRefs;
  };
  if (!g[PLUGIN_TURSO_REFS_KEY]) {
    g[PLUGIN_TURSO_REFS_KEY] = { count: 0 };
  }
  return g[PLUGIN_TURSO_REFS_KEY];
}

/** Register a live plugin instance that depends on the shared Turso pool. */
export function retainPluginTurso(): void {
  pluginTursoRefs().count += 1;
}

/**
 * Drop one plugin-instance lease.
 * @returns `true` when the caller should close the process-wide Turso pool
 *   (last live instance, or no retain was recorded — tests / direct close)
 */
export function releasePluginTursoLease(): boolean {
  const refs = pluginTursoRefs();
  if (refs.count > 0) {
    refs.count -= 1;
    return refs.count === 0;
  }
  // No retain recorded (tests calling memoryClient.close() directly) — close.
  return true;
}

/** Current live plugin-instance lease count (test / diagnostics). */
export function pluginTursoRefCount(): number {
  return pluginTursoRefs().count;
}

/** Reset lease count without touching connections (tests). */
export function resetPluginTursoRefsForTests(): void {
  pluginTursoRefs().count = 0;
}
