import { DOMParser } from "@xmldom/xmldom";
import type { SchemaModel } from "../model/schemaModel.js";
import type { DocumentSource } from "../parser/xsdLoader.js";
import { patchSchemaDocument } from "./domPatcher.js";
import { serializeDocument } from "./domSerialize.js";

/**
 * Re-parses each original document fresh (rather than reusing the parser Worker's now-discarded
 * DOM — see model/types.ts SourceRef) and patches it to match the current model, returning
 * updated DocumentSource[] ready to write back to disk. `originalDocuments` should be exactly
 * what was passed to loadSchemaSetFromDocuments when the schema was loaded (same fileId/xml),
 * so `sourceRef.path` pointers still resolve correctly.
 */
export function serializeSchemaSet(originalDocuments: DocumentSource[], model: SchemaModel): DocumentSource[] {
  const schemaSet = model.getSchemaSet();
  if (!schemaSet) {
    throw new Error("serializeSchemaSet: model has no SchemaSet (was it loaded via loadSchemaSetFromDocuments?)");
  }

  return originalDocuments.map((source) => {
    const schemaDocument = schemaSet.documents[source.fileId];
    if (!schemaDocument) return source;
    const doc = new DOMParser().parseFromString(source.xml, "application/xml");
    patchSchemaDocument(doc, schemaDocument, model);
    return { ...source, xml: serializeDocument(doc) };
  });
}
