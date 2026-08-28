import type { SchemaModel } from "../model/schemaModel.js";

/**
 * Every edit is a Command so undo/redo (desktop app's schemaStore.ts) and the future DOM-patch
 * serializer (Phase 4) can share the same minimal before/after diff instead of computing one
 * from full-model snapshots. `apply` must be called exactly once before `invert()` — invert()
 * captures the pre-apply state during `apply` and returns a Command that restores it.
 */
export interface Command {
  apply(model: SchemaModel): void;
  invert(): Command;
  /** Short human-readable label, e.g. for a future undo-history UI. */
  describe(): string;
}
