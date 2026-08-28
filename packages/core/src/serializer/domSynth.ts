import type { AttributeDecl, ElementDecl, OccursBound } from "../model/types.js";
import type { PrefixAllocator } from "./qnameSerializer.js";
import { serializeQName } from "./qnameSerializer.js";
import { XSD_NAMESPACE, setOrRemoveAttr, setOrRemoveBoolAttr } from "./domHelpers.js";

function occursToString(value: OccursBound): string {
  return value === "unbounded" ? "unbounded" : String(value);
}

function createXsdElement(doc: Document, localName: string, allocator: PrefixAllocator): Element {
  const prefix = allocator.resolvePrefix(XSD_NAMESPACE);
  return doc.createElementNS(XSD_NAMESPACE, prefix ? `${prefix}:${localName}` : localName);
}

/** Synthesizes a brand-new `<xs:element>` particle for a node created via AddChildCommand (no sourceRef yet). */
export function synthesizeElement(doc: Document, node: ElementDecl, allocator: PrefixAllocator): Element {
  const el = createXsdElement(doc, "element", allocator);
  applyElementAttributes(el, node, allocator);
  return el;
}

/** Synthesizes a brand-new `<xs:attribute>` for a node created via AddChildCommand (no sourceRef yet). */
export function synthesizeAttribute(doc: Document, node: AttributeDecl, allocator: PrefixAllocator): Element {
  const el = createXsdElement(doc, "attribute", allocator);
  applyAttributeAttributes(el, node, allocator);
  return el;
}

export function applyElementAttributes(el: Element, node: ElementDecl, allocator: PrefixAllocator): void {
  setOrRemoveAttr(el, "name", node.name);
  if (node.typeRef !== null && typeof node.typeRef === "object") {
    el.setAttribute("type", serializeQName(node.typeRef.qname, allocator));
  } else if (typeof node.typeRef !== "string") {
    el.removeAttribute("type");
  }
  setOrRemoveAttr(el, "minOccurs", node.minOccurs === 1 ? null : occursToString(node.minOccurs));
  setOrRemoveAttr(el, "maxOccurs", node.maxOccurs === 1 ? null : occursToString(node.maxOccurs));
  setOrRemoveBoolAttr(el, "nillable", node.nillable);
  setOrRemoveBoolAttr(el, "abstract", node.abstract);
  setOrRemoveAttr(el, "default", node.default);
  setOrRemoveAttr(el, "fixed", node.fixed);
  if (node.substitutionGroupRef) {
    el.setAttribute("substitutionGroup", serializeQName(node.substitutionGroupRef.qname, allocator));
  } else {
    el.removeAttribute("substitutionGroup");
  }
}

export function applyAttributeAttributes(el: Element, node: AttributeDecl, allocator: PrefixAllocator): void {
  if (node.ref) {
    el.setAttribute("ref", serializeQName(node.ref.qname, allocator));
    el.removeAttribute("name");
    el.removeAttribute("type");
    setOrRemoveAttr(el, "use", node.use === "optional" ? null : node.use);
    setOrRemoveAttr(el, "default", node.default);
    setOrRemoveAttr(el, "fixed", node.fixed);
    return;
  }
  el.removeAttribute("ref");
  setOrRemoveAttr(el, "name", node.name);
  if (node.typeRef !== null && typeof node.typeRef === "object") {
    el.setAttribute("type", serializeQName(node.typeRef.qname, allocator));
  } else if (typeof node.typeRef !== "string") {
    el.removeAttribute("type");
  }
  setOrRemoveAttr(el, "use", node.use === "optional" ? null : node.use);
  setOrRemoveAttr(el, "default", node.default);
  setOrRemoveAttr(el, "fixed", node.fixed);
}
