import { XMLSerializer } from "@xmldom/xmldom";

export function serializeDocument(doc: Document): string {
  return new XMLSerializer().serializeToString(doc);
}
