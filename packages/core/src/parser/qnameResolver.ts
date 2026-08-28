import type { QName, QNameRef } from "../model/types.js";

export interface NamespaceScope {
  defaultNamespace: string | null;
  prefixes: Map<string, string>;
}

const ELEMENT_NODE = 1;

function isElement(node: Node | null): node is Element {
  return !!node && node.nodeType === ELEMENT_NODE;
}

/**
 * Walks an element's ancestor chain (root to leaf) collecting `xmlns`/`xmlns:*` declarations,
 * so later declarations (closer to the element) override earlier ones — standard XML namespace
 * scoping. Used to resolve QName-valued attributes (`type="tns:Foo"`, `base="tns:Bar"`, ...),
 * which generic DOM parsing does not resolve on its own (unlike element/attribute tag names).
 */
export function resolveNamespaceScope(element: Element): NamespaceScope {
  const chain: Element[] = [];
  let current: Element | null = element;
  while (current) {
    chain.push(current);
    current = isElement(current.parentNode) ? current.parentNode : null;
  }

  const prefixes = new Map<string, string>();
  let defaultNamespace: string | null = null;

  for (let i = chain.length - 1; i >= 0; i -= 1) {
    const el = chain[i];
    for (let a = 0; a < el.attributes.length; a += 1) {
      const attr = el.attributes.item(a);
      if (!attr) continue;
      if (attr.name === "xmlns") {
        defaultNamespace = attr.value || null;
      } else if (attr.name.startsWith("xmlns:")) {
        prefixes.set(attr.name.slice("xmlns:".length), attr.value);
      }
    }
  }

  return { defaultNamespace, prefixes };
}

export function parseQNameString(raw: string, scope: NamespaceScope): QName {
  const trimmed = raw.trim();
  const separatorIndex = trimmed.indexOf(":");
  if (separatorIndex === -1) {
    return { namespaceURI: scope.defaultNamespace, localName: trimmed };
  }
  const prefix = trimmed.slice(0, separatorIndex);
  const localName = trimmed.slice(separatorIndex + 1);
  return { namespaceURI: scope.prefixes.get(prefix) ?? null, localName };
}

export function toQNameRef(raw: string | null | undefined, scope: NamespaceScope): QNameRef | null {
  if (!raw) return null;
  return { qname: parseQNameString(raw, scope), resolvedTargetId: null };
}

export const XSD_NAMESPACE = "http://www.w3.org/2001/XMLSchema";
export { ELEMENT_NODE };
