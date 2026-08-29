import { nextId, type SchemaModel } from "../model/schemaModel.js";
import type {
  AnyNode,
  Annotation,
  AttributeDecl,
  AttributeGroupDecl,
  Compositor,
  CompositorNode,
  ComplexTypeDecl,
  ComplexTypeDerivation,
  ElementDecl,
  ElementRefNode,
  Facets,
  GroupDecl,
  GroupRefNode,
  OccursBound,
  QNameRef,
  SchemaDocument,
  SimpleTypeDecl,
  SimpleTypeVariant
} from "../model/types.js";
import type { NodeId } from "../model/nodeId.js";
import { resolveNamespaceScope, toQNameRef, XSD_NAMESPACE, type NamespaceScope } from "./qnameResolver.js";

const ELEMENT_NODE = 1;
const COMPOSITOR_KINDS: ReadonlySet<string> = new Set(["sequence", "choice", "all"]);

function childElements(node: Node): Element[] {
  const result: Element[] = [];
  for (let i = 0; i < node.childNodes.length; i += 1) {
    const child = node.childNodes[i];
    if (child.nodeType === ELEMENT_NODE) {
      result.push(child as Element);
    }
  }
  return result;
}

function isXsd(el: Element, localName: string): boolean {
  return el.namespaceURI === XSD_NAMESPACE && el.localName === localName;
}

function attr(el: Element, name: string): string | null {
  return el.hasAttribute(name) ? el.getAttribute(name) : null;
}

function boolAttr(el: Element, name: string): boolean {
  return attr(el, name) === "true" || attr(el, name) === "1";
}

function parseMinOccurs(raw: string | null): number {
  if (raw === null) return 1;
  const n = Number.parseInt(raw, 10);
  return Number.isNaN(n) ? 1 : n;
}

function parseMaxOccurs(raw: string | null): OccursBound {
  if (raw === null) return 1;
  if (raw === "unbounded") return "unbounded";
  const n = Number.parseInt(raw, 10);
  return Number.isNaN(n) ? 1 : n;
}

/**
 * Per-parent cache of child->index, built once per parent on first lookup. A schema root can have
 * tens of thousands of direct children (one per top-level declaration); computing each child's
 * index via `Array.prototype.indexOf` there is O(children) per call, so an uncached nodePath()
 * that climbs to the root for every node is O(n^2) overall for large schemas (measured: 36s parse
 * at 32MB vs. 2.6s at 8MB before this fix). Caching each parent's index map amortizes this to O(n).
 */
const childIndexCache = new WeakMap<Node, Map<Node, number>>();

function indexOfChild(parent: Node, child: Node): number {
  let indexByChild = childIndexCache.get(parent);
  if (!indexByChild) {
    indexByChild = new Map();
    for (let i = 0; i < parent.childNodes.length; i += 1) {
      indexByChild.set(parent.childNodes[i], i);
    }
    childIndexCache.set(parent, indexByChild);
  }
  return indexByChild.get(child) ?? -1;
}

/** Absolute childNodes-index path from the owning Document down to `el`, used as a relocatable source pointer. */
function nodePath(el: Element): number[] {
  const path: number[] = [];
  let node: Node = el;
  while (node.parentNode) {
    const parent: Node = node.parentNode;
    const index = indexOfChild(parent, node);
    path.unshift(index);
    node = parent;
  }
  return path;
}

function readAnnotation(container: Element): Annotation | null {
  const annotationEl = childElements(container).find((c) => isXsd(c, "annotation"));
  if (!annotationEl) return null;

  const documentation: string[] = [];
  const appInfo: string[] = [];
  for (const child of childElements(annotationEl)) {
    if (isXsd(child, "documentation") && child.textContent) {
      documentation.push(child.textContent.trim());
    } else if (isXsd(child, "appinfo") && child.textContent) {
      appInfo.push(child.textContent.trim());
    }
  }
  if (documentation.length === 0 && appInfo.length === 0) return null;
  return { documentation, appInfo };
}

interface ParseContext {
  model: SchemaModel;
  fileId: string;
  docNamespace: string | null;
}

interface ContentModelBody {
  contentModelId: NodeId | null;
  attributeIds: NodeId[];
  attributeGroupRefs: QNameRef[];
}

function parseContentModelBody(container: Element, scope: NamespaceScope, ctx: ParseContext): ContentModelBody {
  const attributeIds: NodeId[] = [];
  const attributeGroupRefs: QNameRef[] = [];
  let contentModelId: NodeId | null = null;

  for (const child of childElements(container)) {
    if (isXsd(child, "annotation")) continue;

    if (COMPOSITOR_KINDS.has(child.localName) && child.namespaceURI === XSD_NAMESPACE) {
      if (contentModelId === null) {
        contentModelId = parseCompositor(child, scope, ctx);
      }
    } else if (isXsd(child, "group")) {
      if (contentModelId === null) {
        contentModelId = parseGroupRefParticle(child, scope, ctx);
      }
    } else if (isXsd(child, "attribute")) {
      attributeIds.push(parseAttributeDecl(child, scope, ctx));
    } else if (isXsd(child, "attributeGroup")) {
      const ref = toQNameRef(attr(child, "ref"), scope);
      if (ref) attributeGroupRefs.push(ref);
    }
    // xs:anyAttribute (wildcard) is intentionally not modeled yet — see docs/PLAN.md risk notes.
  }

  return { contentModelId, attributeIds, attributeGroupRefs };
}

function parseCompositor(el: Element, scope: NamespaceScope, ctx: ParseContext): NodeId {
  const particleIds: NodeId[] = [];

  for (const child of childElements(el)) {
    if (isXsd(child, "annotation")) continue;
    if (isXsd(child, "element")) {
      particleIds.push(
        attr(child, "ref") !== null
          ? parseElementRef(child, scope, ctx)
          : parseElementDecl(child, scope, ctx)
      );
    } else if (COMPOSITOR_KINDS.has(child.localName) && child.namespaceURI === XSD_NAMESPACE) {
      particleIds.push(parseCompositor(child, scope, ctx));
    } else if (isXsd(child, "group")) {
      particleIds.push(parseGroupRefParticle(child, scope, ctx));
    } else if (isXsd(child, "any")) {
      particleIds.push(parseAnyParticle(child, ctx));
    }
  }

  const node: CompositorNode = {
    id: nextId("compositor"),
    kind: "compositor",
    name: null,
    namespaceURI: null,
    annotation: readAnnotation(el),
    sourceRef: { fileId: ctx.fileId, path: nodePath(el) },
    compositor: el.localName as Compositor,
    minOccurs: parseMinOccurs(attr(el, "minOccurs")),
    maxOccurs: parseMaxOccurs(attr(el, "maxOccurs")),
    particleIds
  };
  return ctx.model.addNode(node);
}

function parseAnyParticle(el: Element, ctx: ParseContext): NodeId {
  const processContents = attr(el, "processContents");
  const node: AnyNode = {
    id: nextId("any"),
    kind: "any",
    name: null,
    namespaceURI: null,
    annotation: readAnnotation(el),
    sourceRef: { fileId: ctx.fileId, path: nodePath(el) },
    namespace: attr(el, "namespace"),
    processContents: processContents === "lax" || processContents === "skip" ? processContents : "strict",
    minOccurs: parseMinOccurs(attr(el, "minOccurs")),
    maxOccurs: parseMaxOccurs(attr(el, "maxOccurs"))
  };
  return ctx.model.addNode(node);
}

function parseGroupRefParticle(el: Element, scope: NamespaceScope, ctx: ParseContext): NodeId {
  const ref = toQNameRef(attr(el, "ref"), scope);
  const node: GroupRefNode = {
    id: nextId("groupRef"),
    kind: "groupRef",
    name: null,
    namespaceURI: null,
    annotation: readAnnotation(el),
    sourceRef: { fileId: ctx.fileId, path: nodePath(el) },
    ref: ref ?? { qname: { namespaceURI: null, localName: "" }, resolvedTargetId: null },
    minOccurs: parseMinOccurs(attr(el, "minOccurs")),
    maxOccurs: parseMaxOccurs(attr(el, "maxOccurs"))
  };
  return ctx.model.addNode(node);
}

function parseElementRef(el: Element, scope: NamespaceScope, ctx: ParseContext): NodeId {
  const ref = toQNameRef(attr(el, "ref"), scope);
  const node: ElementRefNode = {
    id: nextId("elementRef"),
    kind: "elementRef",
    name: null,
    namespaceURI: null,
    annotation: readAnnotation(el),
    sourceRef: { fileId: ctx.fileId, path: nodePath(el) },
    ref: ref ?? { qname: { namespaceURI: null, localName: "" }, resolvedTargetId: null },
    minOccurs: parseMinOccurs(attr(el, "minOccurs")),
    maxOccurs: parseMaxOccurs(attr(el, "maxOccurs"))
  };
  return ctx.model.addNode(node);
}

function parseElementDecl(el: Element, scope: NamespaceScope, ctx: ParseContext): NodeId {
  const name = attr(el, "name");
  const inlineType = childElements(el).find((c) => isXsd(c, "complexType") || isXsd(c, "simpleType"));

  let typeRef: ElementDecl["typeRef"] = null;
  if (inlineType) {
    typeRef = isXsd(inlineType, "complexType")
      ? parseComplexTypeDecl(inlineType, scope, ctx)
      : parseSimpleTypeDecl(inlineType, scope, ctx);
  } else {
    typeRef = toQNameRef(attr(el, "type"), scope);
  }

  const node: ElementDecl = {
    id: nextId("element"),
    kind: "element",
    name,
    namespaceURI: name !== null ? ctx.docNamespace : null,
    annotation: readAnnotation(el),
    sourceRef: { fileId: ctx.fileId, path: nodePath(el) },
    typeRef,
    minOccurs: parseMinOccurs(attr(el, "minOccurs")),
    maxOccurs: parseMaxOccurs(attr(el, "maxOccurs")),
    nillable: boolAttr(el, "nillable"),
    default: attr(el, "default"),
    fixed: attr(el, "fixed"),
    abstract: boolAttr(el, "abstract"),
    substitutionGroupRef: toQNameRef(attr(el, "substitutionGroup"), scope)
  };
  return ctx.model.addNode(node);
}

function parseComplexTypeDecl(el: Element, scope: NamespaceScope, ctx: ParseContext): NodeId {
  const name = attr(el, "name");
  const children = childElements(el).filter((c) => !isXsd(c, "annotation"));
  const wrapper = children.find((c) => isXsd(c, "simpleContent") || isXsd(c, "complexContent"));

  let derivation: ComplexTypeDerivation | null = null;
  let body: ContentModelBody = { contentModelId: null, attributeIds: [], attributeGroupRefs: [] };

  if (wrapper) {
    const derivationEl = childElements(wrapper).find((c) => isXsd(c, "extension") || isXsd(c, "restriction"));
    if (derivationEl) {
      const baseRef = toQNameRef(attr(derivationEl, "base"), scope);
      if (baseRef) {
        derivation = { kind: derivationEl.localName as "extension" | "restriction", baseRef };
      }
      body = parseContentModelBody(derivationEl, scope, ctx);
    }
  } else {
    body = parseContentModelBody(el, scope, ctx);
  }

  const node: ComplexTypeDecl = {
    id: nextId("complexType"),
    kind: "complexType",
    name,
    namespaceURI: name !== null ? ctx.docNamespace : null,
    annotation: readAnnotation(el),
    sourceRef: { fileId: ctx.fileId, path: nodePath(el) },
    abstract: boolAttr(el, "abstract"),
    mixed: boolAttr(el, "mixed"),
    derivation,
    contentModelId: body.contentModelId,
    attributeIds: body.attributeIds,
    attributeGroupRefs: body.attributeGroupRefs
  };
  return ctx.model.addNode(node);
}

function parseSimpleTypeDecl(el: Element, scope: NamespaceScope, ctx: ParseContext): NodeId {
  const name = attr(el, "name");
  const restriction = childElements(el).find((c) => isXsd(c, "restriction"));
  const list = childElements(el).find((c) => isXsd(c, "list"));
  const union = childElements(el).find((c) => isXsd(c, "union"));

  let variant: SimpleTypeVariant = "restriction";
  let baseRef: QNameRef | null = null;
  let itemTypeRef: QNameRef | null = null;
  let memberTypeRefs: QNameRef[] = [];
  const facets: Facets = {};

  if (list) {
    // An inline (anonymous) <xs:list><xs:simpleType>...</xs:simpleType></xs:list> item type is
    // not modeled — only the itemType="..." attribute form (see docs/PLAN.md Phase 6 notes).
    variant = "list";
    itemTypeRef = toQNameRef(attr(list, "itemType"), scope);
  } else if (union) {
    // Inline (anonymous) union member simpleTypes are not modeled — only memberTypes="...".
    variant = "union";
    const raw = attr(union, "memberTypes");
    memberTypeRefs = raw
      ? raw
          .trim()
          .split(/\s+/)
          .filter((token) => token.length > 0)
          .map((token) => toQNameRef(token, scope) as QNameRef)
      : [];
  } else if (restriction) {
    baseRef = toQNameRef(attr(restriction, "base"), scope);
    for (const facetEl of childElements(restriction)) {
      const value = attr(facetEl, "value");
      if (value === null) continue;
      switch (facetEl.localName) {
        case "enumeration":
          (facets.enumeration ??= []).push(value);
          break;
        case "pattern":
          facets.pattern = value;
          break;
        case "minLength":
          facets.minLength = Number.parseInt(value, 10);
          break;
        case "maxLength":
          facets.maxLength = Number.parseInt(value, 10);
          break;
        case "minInclusive":
          facets.minInclusive = value;
          break;
        case "maxInclusive":
          facets.maxInclusive = value;
          break;
        case "totalDigits":
          facets.totalDigits = Number.parseInt(value, 10);
          break;
        case "fractionDigits":
          facets.fractionDigits = Number.parseInt(value, 10);
          break;
        case "whiteSpace":
          if (value === "preserve" || value === "replace" || value === "collapse") {
            facets.whiteSpace = value;
          }
          break;
        default:
          break;
      }
    }
  }

  const node: SimpleTypeDecl = {
    id: nextId("simpleType"),
    kind: "simpleType",
    name,
    variant,
    namespaceURI: name !== null ? ctx.docNamespace : null,
    annotation: readAnnotation(el),
    sourceRef: { fileId: ctx.fileId, path: nodePath(el) },
    baseRef,
    itemTypeRef,
    memberTypeRefs,
    facets
  };
  return ctx.model.addNode(node);
}

function parseGroupDecl(el: Element, scope: NamespaceScope, ctx: ParseContext): NodeId {
  const name = attr(el, "name");
  const compositorEl = childElements(el).find(
    (c) => COMPOSITOR_KINDS.has(c.localName) && c.namespaceURI === XSD_NAMESPACE
  );

  const node: GroupDecl = {
    id: nextId("group"),
    kind: "group",
    name,
    namespaceURI: name !== null ? ctx.docNamespace : null,
    annotation: readAnnotation(el),
    sourceRef: { fileId: ctx.fileId, path: nodePath(el) },
    contentModelId: compositorEl ? parseCompositor(compositorEl, scope, ctx) : null
  };
  return ctx.model.addNode(node);
}

function parseAttributeGroupDecl(el: Element, scope: NamespaceScope, ctx: ParseContext): NodeId {
  const name = attr(el, "name");
  const attributeIds: NodeId[] = [];
  const attributeGroupRefs: QNameRef[] = [];

  for (const child of childElements(el)) {
    if (isXsd(child, "attribute")) {
      attributeIds.push(parseAttributeDecl(child, scope, ctx));
    } else if (isXsd(child, "attributeGroup")) {
      const ref = toQNameRef(attr(child, "ref"), scope);
      if (ref) attributeGroupRefs.push(ref);
    }
  }

  const node: AttributeGroupDecl = {
    id: nextId("attributeGroup"),
    kind: "attributeGroup",
    name,
    namespaceURI: name !== null ? ctx.docNamespace : null,
    annotation: readAnnotation(el),
    sourceRef: { fileId: ctx.fileId, path: nodePath(el) },
    attributeIds,
    attributeGroupRefs
  };
  return ctx.model.addNode(node);
}

function parseAttributeDecl(el: Element, scope: NamespaceScope, ctx: ParseContext): NodeId {
  const refAttr = attr(el, "ref");
  const ref = toQNameRef(refAttr, scope);
  const name = ref ? null : attr(el, "name");

  let typeRef: AttributeDecl["typeRef"] = null;
  if (!ref) {
    const inlineType = childElements(el).find((c) => isXsd(c, "simpleType"));
    typeRef = inlineType ? parseSimpleTypeDecl(inlineType, scope, ctx) : toQNameRef(attr(el, "type"), scope);
  }

  const use = attr(el, "use");
  const node: AttributeDecl = {
    id: nextId("attribute"),
    kind: "attribute",
    name,
    namespaceURI: name !== null ? ctx.docNamespace : null,
    annotation: readAnnotation(el),
    sourceRef: { fileId: ctx.fileId, path: nodePath(el) },
    ref,
    typeRef,
    use: use === "required" || use === "prohibited" ? use : "optional",
    default: attr(el, "default"),
    fixed: attr(el, "fixed")
  };
  return ctx.model.addNode(node);
}

export function parseSchemaDocument(
  doc: Document,
  fileId: string,
  filePath: string,
  model: SchemaModel
): SchemaDocument {
  const root = doc.documentElement;
  const scope = resolveNamespaceScope(root);
  const targetNamespace = attr(root, "targetNamespace");
  const elementFormDefault = attr(root, "elementFormDefault") === "qualified" ? "qualified" : "unqualified";
  const attributeFormDefault = attr(root, "attributeFormDefault") === "qualified" ? "qualified" : "unqualified";
  const namespacePrefixes: Record<string, string> = {};
  scope.prefixes.forEach((uri, prefix) => {
    namespacePrefixes[prefix] = uri;
  });

  const ctx: ParseContext = { model, fileId, docNamespace: targetNamespace };
  const topLevelNodeIds: NodeId[] = [];
  const imports: SchemaDocument["imports"] = [];

  for (const child of childElements(root)) {
    if (child.namespaceURI !== XSD_NAMESPACE) continue;
    switch (child.localName) {
      case "element":
        topLevelNodeIds.push(parseElementDecl(child, scope, ctx));
        break;
      case "complexType":
        topLevelNodeIds.push(parseComplexTypeDecl(child, scope, ctx));
        break;
      case "simpleType":
        topLevelNodeIds.push(parseSimpleTypeDecl(child, scope, ctx));
        break;
      case "group":
        topLevelNodeIds.push(parseGroupDecl(child, scope, ctx));
        break;
      case "attributeGroup":
        topLevelNodeIds.push(parseAttributeGroupDecl(child, scope, ctx));
        break;
      case "attribute":
        topLevelNodeIds.push(parseAttributeDecl(child, scope, ctx));
        break;
      case "import":
        imports.push({ kind: "import", namespace: attr(child, "namespace"), schemaLocation: attr(child, "schemaLocation") });
        break;
      case "include":
        imports.push({ kind: "include", namespace: targetNamespace, schemaLocation: attr(child, "schemaLocation") });
        break;
      // xs:redefine / xs:override / xs:notation: not yet modeled — see docs/PLAN.md risk notes.
      default:
        break;
    }
  }

  return {
    fileId,
    filePath,
    targetNamespace,
    elementFormDefault,
    attributeFormDefault,
    namespacePrefixes,
    topLevelNodeIds,
    imports
  };
}
