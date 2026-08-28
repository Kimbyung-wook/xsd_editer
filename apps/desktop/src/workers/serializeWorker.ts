import { serializeSchemaSet, type DocumentSource, type SchemaNode, type SchemaSet } from "@xsd-visualizer/core";
import { SchemaModel } from "@xsd-visualizer/core";

export interface SerializeRequest {
  documents: DocumentSource[];
  nodes: SchemaNode[];
  schemaSet: SchemaSet;
}

export type SerializeResponse = { ok: true; documents: DocumentSource[] } | { ok: false; error: string };

/**
 * Runs XSD serialization (re-parse original + DOM patch + stringify) off the renderer's main
 * thread, mirroring parseWorker.ts — see docs/PLAN.md "성능 목표". The model can't be passed
 * across the Worker boundary directly (it wraps Maps), so the caller sends the plain node array
 * + SchemaSet and this worker rehydrates a SchemaModel before serializing (schemaStore.ts).
 */
const ctx = self as unknown as {
  onmessage: ((event: { data: SerializeRequest }) => void) | null;
  postMessage: (message: SerializeResponse) => void;
};

ctx.onmessage = (event) => {
  try {
    const model = new SchemaModel();
    for (const node of event.data.nodes) {
      model.addNode(node);
    }
    model.setSchemaSet(event.data.schemaSet);
    const documents = serializeSchemaSet(event.data.documents, model);
    ctx.postMessage({ ok: true, documents });
  } catch (error) {
    ctx.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
