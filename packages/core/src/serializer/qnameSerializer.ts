import type { QName, SchemaDocument } from "../model/types.js";

const XSD_NAMESPACE = "http://www.w3.org/2001/XMLSchema";

export interface PrefixAllocator {
  /** Returns an existing prefix for `namespaceURI`, or declares a fresh `xmlns:nsN` on the document root and returns that. */
  resolvePrefix(namespaceURI: string): string;
}

/**
 * Builds a prefix allocator seeded from the document's originally-parsed xmlns declarations
 * (SchemaDocument.namespacePrefixes), so writing back an unchanged QName reuses the same prefix
 * the file already used. Only declares a new `xmlns:nsN` when a QName references a namespace
 * that had no bound prefix in the original file (e.g. a type newly picked from another loaded
 * document via the Property Panel's type dropdown).
 */
export function createPrefixAllocator(doc: Document, schemaDocument: SchemaDocument): PrefixAllocator {
  const root = doc.documentElement;
  const prefixByNamespace = new Map<string, string>();
  for (const [prefix, uri] of Object.entries(schemaDocument.namespacePrefixes)) {
    if (!prefixByNamespace.has(uri)) {
      prefixByNamespace.set(uri, prefix);
    }
  }
  let counter = 0;

  return {
    resolvePrefix(namespaceURI: string): string {
      const existing = prefixByNamespace.get(namespaceURI);
      if (existing !== undefined) return existing;

      if (namespaceURI === XSD_NAMESPACE && root.prefix) {
        prefixByNamespace.set(namespaceURI, root.prefix);
        return root.prefix;
      }

      let candidate = `ns${counter}`;
      while (root.getAttribute(`xmlns:${candidate}`)) {
        counter += 1;
        candidate = `ns${counter}`;
      }
      root.setAttribute(`xmlns:${candidate}`, namespaceURI);
      prefixByNamespace.set(namespaceURI, candidate);
      return candidate;
    }
  };
}

export function serializeQName(qname: QName, allocator: PrefixAllocator): string {
  if (qname.namespaceURI === null) return qname.localName;
  const prefix = allocator.resolvePrefix(qname.namespaceURI);
  return prefix ? `${prefix}:${qname.localName}` : qname.localName;
}
