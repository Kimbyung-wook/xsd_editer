import type { SchemaImportRef } from "../model/types.js";

const DIRECTIVE_TAG = /<([\w.-]+:)?(import|include)\b([^>]*)>/g;

function extractAttr(attrsText: string, name: string): string | null {
  const doubleQuoted = new RegExp(`${name}\\s*=\\s*"([^"]*)"`).exec(attrsText);
  if (doubleQuoted) return doubleQuoted[1];
  const singleQuoted = new RegExp(`${name}\\s*=\\s*'([^']*)'`).exec(attrsText);
  return singleQuoted ? singleQuoted[1] : null;
}

/**
 * Lightweight text-level scan for `xs:import`/`xs:include` directives, used by the desktop app
 * (schemaStore.ts) to discover which sibling files to fetch *before* handing a full document
 * bundle to the parser (see parser/xsdLoader.ts's loadSchemaSetFromDocuments). A regex scan
 * rather than a full DOM parse here avoids parsing every file in the import graph twice —
 * once for discovery, once for real parsing — since only the schemaLocation/namespace
 * attributes on these two element types are needed at this stage.
 */
export function scanIncludeHrefs(xml: string): SchemaImportRef[] {
  const results: SchemaImportRef[] = [];
  for (const match of xml.matchAll(DIRECTIVE_TAG)) {
    const kind = match[2] as "import" | "include";
    const attrsText = match[3];
    results.push({
      kind,
      namespace: kind === "import" ? extractAttr(attrsText, "namespace") : null,
      schemaLocation: extractAttr(attrsText, "schemaLocation")
    });
  }
  return results;
}
