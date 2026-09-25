// Regression tests for opencode-mem graceful degradation (Bug 3).
//
// When the embedding model fails to initialize, database-only `memory` tool
// modes must keep working; only vector modes may report a degraded error.
//
// Runs on plain Node.js (no bun needed) against the built dist/ output:
//   node --test tests/embedding-degradation.node.mjs

import test from "node:test";
import assert from "node:assert/strict";

import {
  DB_ONLY_MODES,
  DEGRADED_EMBEDDING_HINT,
  checkEmbeddingGate,
  degradedEmbeddingError,
  isDbOnlyMode,
} from "../dist/services/memory-tool-modes.js";

const LOAD_LIBRARY_ERROR =
  "LoadLibrary failed: The operating system cannot run %1.";

test("database-only modes are never blocked by an embedding init error", () => {
  for (const mode of DB_ONLY_MODES) {
    const gate = checkEmbeddingGate(mode, LOAD_LIBRARY_ERROR);
    assert.equal(gate.blocked, false, `mode "${mode}" must work while degraded`);
    assert.equal(gate.needsEmbedding, false, `mode "${mode}" must not need embeddings`);
  }
});

test("list and profile specifically survive the reported Windows failure", () => {
  for (const mode of ["list", "profile", "forget"]) {
    assert.equal(isDbOnlyMode(mode), true);
    const gate = checkEmbeddingGate(mode, LOAD_LIBRARY_ERROR);
    assert.equal(gate.blocked, false);
  }
});

test("vector modes are blocked with a degraded error when init failed", () => {
  for (const mode of ["add", "search", "import"]) {
    assert.equal(isDbOnlyMode(mode), false);
    const gate = checkEmbeddingGate(mode, LOAD_LIBRARY_ERROR);
    assert.equal(gate.blocked, true, `mode "${mode}" must be blocked while degraded`);
    assert.match(gate.error, /Embedding model unavailable/);
    assert.ok(gate.error.includes(LOAD_LIBRARY_ERROR), "original error must be preserved");
    assert.ok(gate.error.includes(DEGRADED_EMBEDDING_HINT), "working modes must be listed");
  }
});

test("vector modes pass the gate before init has failed", () => {
  const gate = checkEmbeddingGate("search", null);
  assert.equal(gate.blocked, false);
  assert.equal(gate.needsEmbedding, true);
});

test("a fresh warmup failure produces a degraded error, not a generic one", () => {
  const error = degradedEmbeddingError("Failed to initialize embedding pipeline");
  assert.match(error, /degraded/i);
  assert.ok(error.includes(DEGRADED_EMBEDDING_HINT));
});

test("the tool payload is valid JSON with the embeddingsDegraded marker", () => {
  const gate = checkEmbeddingGate("add", LOAD_LIBRARY_ERROR);
  assert.equal(gate.blocked, true);
  const payload = { success: false, embeddingsDegraded: true, error: gate.error };
  const roundTripped = JSON.parse(JSON.stringify(payload));
  assert.equal(roundTripped.success, false);
  assert.equal(roundTripped.embeddingsDegraded, true);
});
