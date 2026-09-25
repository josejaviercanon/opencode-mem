/**
 * Mode classification for the `memory` tool.
 *
 * When the embedding model is unavailable (Windows native DLL conflicts,
 * offline first run) database-only modes must keep working. Only modes that
 * need vectors are gated behind a successful embedding warmup.
 */
export const DB_ONLY_MODES = [
  "help",
  "list",
  "profile",
  "forget",
  "list-shards",
  "migrate",
  "export",
] as const;

/** True when the mode only reads/writes the database and needs no vectors. */
export function isDbOnlyMode(mode: string): boolean {
  return (DB_ONLY_MODES as readonly string[]).includes(mode);
}

/** Shown with every degraded error so callers know what still works. */
export const DEGRADED_EMBEDDING_HINT =
  "Database-only modes still work: list, profile, forget, list-shards, migrate, export.";

/** Standard error text for embedding-dependent modes while degraded. */
export function degradedEmbeddingError(reason: string): string {
  return `Memory embeddings are degraded: ${reason}. ${DEGRADED_EMBEDDING_HINT}`;
}

export type EmbeddingGate =
  | { blocked: true; error: string }
  | { blocked: false; needsEmbedding: boolean };

/**
 * Decide whether a `memory` tool mode may run while embeddings are unhealthy.
 *
 * - DB-only modes are never blocked.
 * - Vector modes are blocked with a degraded error when init already failed.
 * - Vector modes are allowed through when init has not failed yet; the caller
 *   then awaits warmup and handles a fresh failure with
 *   {@link degradedEmbeddingError}.
 */
export function checkEmbeddingGate(
  mode: string,
  embeddingInitError: string | null | undefined
): EmbeddingGate {
  const needsEmbedding = !isDbOnlyMode(mode);
  if (needsEmbedding && embeddingInitError) {
    return {
      blocked: true,
      error: `Embedding model unavailable: ${embeddingInitError}. ${DEGRADED_EMBEDDING_HINT}`,
    };
  }
  return { blocked: false, needsEmbedding };
}
