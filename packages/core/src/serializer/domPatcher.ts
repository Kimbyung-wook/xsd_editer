import type { NodeId } from "../model/nodeId.js";
import type { SchemaModel } from "../model/schemaModel.js";
import type {
  AttributeDecl,
  CompositorNode,
  ElementDecl,
  Facets,
  OccursBound,
  QNameRef,
  SchemaDocument,
  SchemaNode
} from "../model/types.js";
import { XSD_NAMESPACE, childElements, isXsd, replaceManagedChildren, resolvePath, setOrRemoveAttr, setOrRemoveBoolAttr } from "./domHelpers.js";
import { applyAttributeAttributes, applyElementAttributes, synthesizeAttribute, synthesizeElement } from "./domSynth.js";
import { createPrefixAllocator, serializeQName, type PrefixAllocator } from "./qnameSerializer.js";

const COMPOSITOR_LOCAL_NAMES = new Set(["sequence", "choice", "all"]);
/** `xs:any` (wildcard) is deliberately excluded — it isn't modeled (see docs/PLAN.md risk notes),
 * so it's left untouched wherever it sits rather than reconciled against the model's particle list.
 * Structurally editing a compositor that mixes modeled particles with `xs:any` can therefore
 * change their relative order — a disclosed, accepted limitation for this unmodeled construct. */
const PARTICLE_LOCAL_NAMES = new Set(["element", "group", ...COMPOSITOR_LOCAL_NAMES]);
const ATTRIBUTE_LOCAL_NAMES = new Set(["attribute"]);
const FACET_LOCAL_NAMES = new Set([
  "enumeration",
  "pattern",
  "minLength",
  "maxLength",
  "minInclusive",
  "maxInclusive",
  "totalDigits",
  "fractionDigits",
  "whiteSpace"
]);

function occursToString(value: OccursBound): string {
  return value === "unbounded" ? "unbounded" : String(value);
}

function createXsdElement(doc: Document, localName: string, allocator: PrefixAllocator): Element {
  const prefix = allocator.resolvePrefix(XSD_NAMESPACE);
  return doc.createElementNS(XSD_NAMESPACE, prefix ? `${prefix}:${localName}` : localName);
}

function managedChildOf(el: Element, names: ReadonlySet<string>): Element | undefined {
  return childElements(el).find((c) => names.has(c.localName) && c.namespaceURI === XSD_NAMESPACE);
}

function applyRefAttributes(el: Element, ref: QNameRef, minOccurs: number, maxOccurs: OccursBound, allocator: PrefixAllocator): void {
  el.setAttribute("ref", serializeQName(ref.qname, allocator));
  setOrRemoveAttr(el, "minOccurs", minOccurs === 1 ? null : occursToString(minOccurs));
  setOrRemoveAttr(el, "maxOccurs", maxOccurs === 1 ? null : occursToString(maxOccurs));
}

/** True when `containerEl`'s current managed-name children are exactly the model's `ids`, in order — i.e. nothing to do. */
function listMatchesDom(doc: Document, containerEl: Element, ids: NodeId[], model: SchemaModel, managedLocalNames: ReadonlySet<string>): boolean {
  const current = childElements(containerEl).filter((el) => managedLocalNames.has(el.localName) && el.namespaceURI === XSD_NAMESPACE);
  if (current.length !== ids.length) return false;
  for (let i = 0; i < ids.length; i += 1) {
    const node = model.getNode(ids[i]);
    if (!node?.sourceRef) return false;
    if (resolvePath(doc, node.sourceRef.path) !== current[i]) return false;
  }
  return true;
}

function patchList(doc: Document, containerEl: Element, ids: NodeId[], model: SchemaModel, allocator: PrefixAllocator, managedLocalNames: ReadonlySet<string>): void {
  if (listMatchesDom(doc, containerEl, ids, model, managedLocalNames)) {
    // Membership/order unchanged — still patch each existing particle's own fields in place
    // (resolveOrSynthesizeParticle patches an existing element rather than replacing it), just
    // without touching this container's child ordering/whitespace.
    for (const id of ids) {
      resolveOrSynthesizeParticle(doc, id, model, allocator);
    }
    return;
  }
  const elements = ids.map((id) => resolveOrSynthesizeParticle(doc, id, model, allocator));
  replaceManagedChildren(doc, containerEl, managedLocalNames, elements);
}

/** Ensures exactly one managed-name child equals `desiredEl` (used for complexType/group's single content-model slot). */
function patchSingleSlot(doc: Document, containerEl: Element, desiredEl: Element, managedLocalNames: ReadonlySet<string>): void {
  const current = managedChildOf(containerEl, managedLocalNames);
  if (current === desiredEl) return;
  replaceManagedChildren(doc, containerEl, managedLocalNames, [desiredEl]);
}

function findContentContainer(complexTypeEl: Element): Element {
  const wrapper = childElements(complexTypeEl).find((c) => isXsd(c, "simpleContent") || isXsd(c, "complexContent"));
  if (!wrapper) return complexTypeEl;
  const derivation = childElements(wrapper).find((c) => isXsd(c, "extension") || isXsd(c, "restriction"));
  return derivation ?? complexTypeEl;
}

function getOrCreateRestriction(doc: Document, simpleTypeEl: Element, allocator: PrefixAllocator): Element {
  const existing = childElements(simpleTypeEl).find((c) => isXsd(c, "restriction"));
  if (existing) return existing;
  const created = createXsdElement(doc, "restriction", allocator);
  replaceManagedChildren(doc, simpleTypeEl, new Set(["restriction"]), [created]);
  return created;
}

function arraysEqual(a: string[] | undefined, b: string[] | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function facetsEqual(a: Facets, b: Facets): boolean {
  return (
    arraysEqual(a.enumeration, b.enumeration) &&
    a.pattern === b.pattern &&
    a.minLength === b.minLength &&
    a.maxLength === b.maxLength &&
    a.minInclusive === b.minInclusive &&
    a.maxInclusive === b.maxInclusive &&
    a.totalDigits === b.totalDigits &&
    a.fractionDigits === b.fractionDigits &&
    a.whiteSpace === b.whiteSpace
  );
}

function readFacetsFromDom(restrictionEl: Element): Facets {
  const facets: Facets = {};
  for (const el of childElements(restrictionEl)) {
    if (el.namespaceURI !== XSD_NAMESPACE || !FACET_LOCAL_NAMES.has(el.localName)) continue;
    const value = el.getAttribute("value");
    if (value === null) continue;
    switch (el.localName) {
      case "enumeration":
        (facets.enumeration ??= []).push(value);
        break;
      case "pattern":
        facets.pattern = value;
        break;
      case "minLength":
        facets.minLength = Number(value);
        break;
      case "maxLength":
        facets.maxLength = Number(value);
        break;
      case "minInclusive":
        facets.minInclusive = value;
        break;
      case "maxInclusive":
        facets.maxInclusive = value;
        break;
      case "totalDigits":
        facets.totalDigits = Number(value);
        break;
      case "fractionDigits":
        facets.fractionDigits = Number(value);
        break;
      case "whiteSpace":
        if (value === "preserve" || value === "replace" || value === "collapse") facets.whiteSpace = value;
        break;
      default:
        break;
    }
  }
  return facets;
}

function patchFacets(doc: Document, restrictionEl: Element, facets: Facets, allocator: PrefixAllocator): void {
  if (facetsEqual(readFacetsFromDom(restrictionEl), facets)) return;

  const make = (localName: string, value: string): Element => {
    const el = createXsdElement(doc, localName, allocator);
    el.setAttribute("value", value);
    return el;
  };
  const newEls: Element[] = [];
  for (const v of facets.enumeration ?? []) newEls.push(make("enumeration", v));
  if (facets.pattern !== undefined) newEls.push(make("pattern", facets.pattern));
  if (facets.minLength !== undefined) newEls.push(make("minLength", String(facets.minLength)));
  if (facets.maxLength !== undefined) newEls.push(make("maxLength", String(facets.maxLength)));
  if (facets.minInclusive !== undefined) newEls.push(make("minInclusive", facets.minInclusive));
  if (facets.maxInclusive !== undefined) newEls.push(make("maxInclusive", facets.maxInclusive));
  if (facets.totalDigits !== undefined) newEls.push(make("totalDigits", String(facets.totalDigits)));
  if (facets.fractionDigits !== undefined) newEls.push(make("fractionDigits", String(facets.fractionDigits)));
  if (facets.whiteSpace !== undefined) newEls.push(make("whiteSpace", facets.whiteSpace));
  replaceManagedChildren(doc, restrictionEl, FACET_LOCAL_NAMES, newEls);
}

function patchElementNode(doc: Document, el: Element, node: ElementDecl, model: SchemaModel, allocator: PrefixAllocator): void {
  applyElementAttributes(el, node, allocator);
  if (typeof node.typeRef === "string") {
    const inner = model.getNode(node.typeRef);
    if (inner?.sourceRef) {
      const innerEl = resolvePath(doc, inner.sourceRef.path) as Element | null;
      if (innerEl) patchNodeByKind(doc, innerEl, inner, model, allocator);
    }
  }
}

function resolveOrSynthesizeParticle(doc: Document, id: NodeId, model: SchemaModel, allocator: PrefixAllocator): Element {
  const node = model.getNode(id);
  if (!node) throw new Error(`domPatcher: missing node ${id}`);
  const existing = node.sourceRef ? (resolvePath(doc, node.sourceRef.path) as Element | null) : null;

  switch (node.kind) {
    case "element":
      if (existing) {
        patchElementNode(doc, existing, node, model, allocator);
        return existing;
      }
      return synthesizeElement(doc, node, allocator);
    case "elementRef": {
      const el = existing ?? createXsdElement(doc, "element", allocator);
      applyRefAttributes(el, node.ref, node.minOccurs, node.maxOccurs, allocator);
      return el;
    }
    case "groupRef": {
      const el = existing ?? createXsdElement(doc, "group", allocator);
      applyRefAttributes(el, node.ref, node.minOccurs, node.maxOccurs, allocator);
      return el;
    }
    case "compositor": {
      const el = existing ?? createXsdElement(doc, node.compositor, allocator);
      patchNodeByKind(doc, el, node, model, allocator);
      return el;
    }
    case "attribute":
      if (existing) {
        applyAttributeAttributes(existing, node, allocator);
        return existing;
      }
      return synthesizeAttribute(doc, node, allocator);
    default:
      throw new Error(`domPatcher: unsupported particle kind ${node.kind}`);
  }
}

function patchNodeByKind(doc: Document, el: Element, node: SchemaNode, model: SchemaModel, allocator: PrefixAllocator): void {
  switch (node.kind) {
    case "element":
      patchElementNode(doc, el, node, model, allocator);
      break;
    case "attribute":
      applyAttributeAttributes(el, node as AttributeDecl, allocator);
      break;
    case "complexType": {
      setOrRemoveAttr(el, "name", node.name);
      setOrRemoveBoolAttr(el, "abstract", node.abstract);
      setOrRemoveBoolAttr(el, "mixed", node.mixed);
      const contentContainer = findContentContainer(el);
      if (node.contentModelId) {
        const particleEl = resolveOrSynthesizeParticle(doc, node.contentModelId, model, allocator);
        patchSingleSlot(doc, contentContainer, particleEl, COMPOSITOR_LOCAL_NAMES);
      }
      patchList(doc, contentContainer, node.attributeIds, model, allocator, ATTRIBUTE_LOCAL_NAMES);
      // node.derivation (extension/restriction base) isn't editable yet (Phase 3 scope) — left untouched.
      break;
    }
    case "simpleType": {
      setOrRemoveAttr(el, "name", node.name);
      const restrictionEl = getOrCreateRestriction(doc, el, allocator);
      setOrRemoveAttr(restrictionEl, "base", node.baseRef ? serializeQName(node.baseRef.qname, allocator) : null);
      patchFacets(doc, restrictionEl, node.facets, allocator);
      break;
    }
    case "group": {
      setOrRemoveAttr(el, "name", node.name);
      if (node.contentModelId) {
        const particleEl = resolveOrSynthesizeParticle(doc, node.contentModelId, model, allocator);
        patchSingleSlot(doc, el, particleEl, COMPOSITOR_LOCAL_NAMES);
      }
      break;
    }
    case "attributeGroup": {
      setOrRemoveAttr(el, "name", node.name);
      patchList(doc, el, node.attributeIds, model, allocator, ATTRIBUTE_LOCAL_NAMES);
      break;
    }
    case "compositor": {
      const compositorNode = node as CompositorNode;
      setOrRemoveAttr(el, "minOccurs", compositorNode.minOccurs === 1 ? null : occursToString(compositorNode.minOccurs));
      setOrRemoveAttr(el, "maxOccurs", compositorNode.maxOccurs === 1 ? null : occursToString(compositorNode.maxOccurs));
      patchList(doc, el, compositorNode.particleIds, model, allocator, PARTICLE_LOCAL_NAMES);
      break;
    }
    default:
      break;
  }
}

/**
 * Patches `doc` (a fresh re-parse of the file this SchemaDocument came from) in place so it
 * reflects the current SchemaModel state, touching only the DOM subtrees that actually changed
 * (see docs/PLAN.md "라운드트립 신뢰성"). Top-level add/delete isn't supported by any command yet
 * (Phase 3 scope), so `schemaDocument.topLevelNodeIds` entries always resolve to existing nodes.
 */
export function patchSchemaDocument(doc: Document, schemaDocument: SchemaDocument, model: SchemaModel): void {
  const allocator = createPrefixAllocator(doc, schemaDocument);
  for (const id of schemaDocument.topLevelNodeIds) {
    const node = model.getNode(id);
    if (!node?.sourceRef) continue;
    const el = resolvePath(doc, node.sourceRef.path) as Element | null;
    if (!el) continue;
    patchNodeByKind(doc, el, node, model, allocator);
  }
}
