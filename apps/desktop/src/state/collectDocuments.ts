import { scanIncludeHrefs, type DocumentSource } from "@xsd-visualizer/core";
import type { XsdFileApi } from "../globals.js";

function isRemoteHref(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(href);
}

/**
 * Recursively walks an entry XSD's xs:import/xs:include chain, reading every referenced file
 * from disk via the Electron main process (real fs access lives there — see electron/main.ts),
 * and returns the flat document bundle the pure, I/O-free core parser
 * (loadSchemaSetFromDocuments) needs. Cycles are broken by tracking resolved absolute paths.
 */
export async function collectDocuments(entryFilePath: string, api: XsdFileApi): Promise<DocumentSource[]> {
  const documents: DocumentSource[] = [];
  const visited = new Set<string>([entryFilePath]);
  const queue: string[] = [entryFilePath];

  while (queue.length > 0) {
    const filePath = queue.shift()!;
    const xml = await api.readTextFile(filePath);
    documents.push({ fileId: filePath, filePath, xml });

    for (const ref of scanIncludeHrefs(xml)) {
      if (!ref.schemaLocation || isRemoteHref(ref.schemaLocation)) continue;
      const resolved = await api.resolveImportPath(filePath, ref.schemaLocation);
      if (visited.has(resolved)) continue;
      visited.add(resolved);
      queue.push(resolved);
    }
  }

  return documents;
}
