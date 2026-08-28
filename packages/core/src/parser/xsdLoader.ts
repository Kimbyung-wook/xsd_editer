import { DOMParser } from "@xmldom/xmldom";
import { SchemaModel } from "../model/schemaModel.js";
import type { SchemaSet } from "../model/types.js";
import { parseSchemaDocument } from "./domToModel.js";

export interface LoadResult {
  model: SchemaModel;
  schemaSet: SchemaSet;
}

export interface DocumentSource {
  fileId: string;
  filePath: string;
  xml: string;
}

/**
 * Parses an already-collected set of XSD documents (entry file plus everything its
 * xs:import/xs:include chain pulled in — see parser/scanIncludes.ts for how the caller
 * discovers that set) into one shared SchemaModel. Pure and synchronous — no filesystem
 * access — so it runs the same in a Node test, a browser main thread, or the parser Web
 * Worker (apps/desktop's parseWorker.ts): the I/O to gather `documents` happens beforehand
 * in the renderer/main process, which is where real file access lives (see docs/PLAN.md
 * "다중 파일 병합 범위").
 */
export function loadSchemaSetFromDocuments(documents: DocumentSource[]): LoadResult {
  if (documents.length === 0) {
    throw new Error("loadSchemaSetFromDocuments: at least one document is required");
  }

  const model = new SchemaModel();
  const schemaDocuments: SchemaSet["documents"] = {};

  for (const source of documents) {
    const doc = new DOMParser().parseFromString(source.xml, "application/xml");
    schemaDocuments[source.fileId] = parseSchemaDocument(doc, source.fileId, source.filePath, model);
  }

  const schemaSet: SchemaSet = { documents: schemaDocuments, primaryFileId: documents[0].fileId };
  model.setSchemaSet(schemaSet);
  return { model, schemaSet };
}

/** Parses a single XSD document (as a string) into a fresh SchemaModel — no import/include resolution. */
export function loadSchemaFromString(xml: string, fileId: string, filePath: string): LoadResult {
  return loadSchemaSetFromDocuments([{ fileId, filePath, xml }]);
}
