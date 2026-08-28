import { loadSchemaSetFromDocuments, type DocumentSource, type SchemaNode, type SchemaSet } from "@xsd-visualizer/core";

export interface ParseRequest {
  documents: DocumentSource[];
}

export type ParseResponse =
  | { ok: true; nodes: SchemaNode[]; schemaSet: SchemaSet }
  | { ok: false; error: string };

/**
 * Runs XSD parsing off the renderer's main thread (see docs/PLAN.md "성능 목표"). File I/O
 * (reading the entry file plus everything its xs:import/xs:include chain pulls in) happens
 * beforehand in the renderer via Electron IPC (state/collectDocuments.ts) — this worker only
 * does pure parsing over the already-collected document bundle. The parsed SchemaModel itself
 * isn't structured-clone-safe (it wraps Maps), so this posts back the plain node array +
 * SchemaSet and the caller rehydrates a SchemaModel from them (schemaStore.ts).
 */
const ctx = self as unknown as {
  onmessage: ((event: { data: ParseRequest }) => void) | null;
  postMessage: (message: ParseResponse) => void;
};

ctx.onmessage = (event) => {
  try {
    const { model, schemaSet } = loadSchemaSetFromDocuments(event.data.documents);
    ctx.postMessage({ ok: true, nodes: [...model.allNodes()], schemaSet });
  } catch (error) {
    ctx.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
