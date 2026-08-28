import type { NodeId } from "./nodeId.js";

export interface QName {
  namespaceURI: string | null;
  localName: string;
}

/** A reference to another named schema entity by QName, resolved lazily by the resolver module (Phase 2). */
export interface QNameRef {
  qname: QName;
  /** Populated by resolver/resolveReferences.ts once the target entity is known; null if dangling or not yet resolved. */
  resolvedTargetId: NodeId | null;
}

export interface Annotation {
  documentation: string[];
  appInfo: string[];
}

/**
 * Points back to the node's position in its origin document so the serializer (Phase 4) can
 * relocate and patch the original DOM in place. Stored as a childNodes-index path rather than a
 * live DOM reference so parse results stay structured-clone-safe across the parser Web Worker
 * boundary (Phase 1 runs parsing off the main thread).
 */
export interface SourceRef {
  fileId: string;
  path: number[];
}

export type OccursBound = number | "unbounded";

interface BaseNode {
  id: NodeId;
  name: string | null;
  /** The owning document's targetNamespace; null for the no-namespace case. Set by the parser. */
  namespaceURI: string | null;
  annotation: Annotation | null;
  sourceRef: SourceRef | null;
}

export interface ElementDecl extends BaseNode {
  kind: "element";
  /** QNameRef for a named-type reference, or the NodeId of an anonymous inline type parsed inline. */
  typeRef: QNameRef | NodeId | null;
  minOccurs: number;
  maxOccurs: OccursBound;
  nillable: boolean;
  default: string | null;
  fixed: string | null;
  abstract: boolean;
  substitutionGroupRef: QNameRef | null;
}

/** `<xs:element ref="...">` used as a content-model particle; reuses a globally declared element. */
export interface ElementRefNode extends BaseNode {
  kind: "elementRef";
  ref: QNameRef;
  minOccurs: number;
  maxOccurs: OccursBound;
}

export type Compositor = "sequence" | "choice" | "all";

/** `xs:sequence` / `xs:choice` / `xs:all` — an ordered/unordered group of content-model particles. */
export interface CompositorNode extends BaseNode {
  kind: "compositor";
  compositor: Compositor;
  minOccurs: number;
  maxOccurs: OccursBound;
  /** Child particles: ElementDecl | ElementRefNode | CompositorNode | GroupRefNode ids, in document order. */
  particleIds: NodeId[];
}

/** `<xs:group ref="...">` used as a content-model particle. */
export interface GroupRefNode extends BaseNode {
  kind: "groupRef";
  ref: QNameRef;
  minOccurs: number;
  maxOccurs: OccursBound;
}

export interface ComplexTypeDerivation {
  kind: "extension" | "restriction";
  baseRef: QNameRef;
}

export interface ComplexTypeDecl extends BaseNode {
  kind: "complexType";
  abstract: boolean;
  mixed: boolean;
  derivation: ComplexTypeDerivation | null;
  /** Root content-model particle (usually a CompositorNode or GroupRefNode); null for attribute-only/empty content. */
  contentModelId: NodeId | null;
  attributeIds: NodeId[];
  attributeGroupRefs: QNameRef[];
}

export interface Facets {
  enumeration?: string[];
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  minInclusive?: string;
  maxInclusive?: string;
  totalDigits?: number;
  fractionDigits?: number;
  whiteSpace?: "preserve" | "replace" | "collapse";
}

export interface SimpleTypeDecl extends BaseNode {
  kind: "simpleType";
  /** Restriction base; null for union/list-derived simple types (not yet modeled, see Phase 6 risk notes). */
  baseRef: QNameRef | null;
  facets: Facets;
}

export interface GroupDecl extends BaseNode {
  kind: "group";
  /** A named group definition wraps exactly one top-level compositor. */
  contentModelId: NodeId | null;
}

export interface AttributeGroupDecl extends BaseNode {
  kind: "attributeGroup";
  attributeIds: NodeId[];
  attributeGroupRefs: QNameRef[];
}

export interface AttributeDecl extends BaseNode {
  kind: "attribute";
  /** Set when this is `<xs:attribute ref="...">`; name/typeRef are then null (inherited from the referenced attribute). */
  ref: QNameRef | null;
  typeRef: QNameRef | NodeId | null;
  use: "required" | "optional" | "prohibited";
  default: string | null;
  fixed: string | null;
}

export type SchemaNode =
  | ElementDecl
  | ElementRefNode
  | CompositorNode
  | GroupRefNode
  | ComplexTypeDecl
  | SimpleTypeDecl
  | GroupDecl
  | AttributeGroupDecl
  | AttributeDecl;

export type SchemaNodeKind = SchemaNode["kind"];

export interface SchemaImportRef {
  kind: "import" | "include";
  /** Only `xs:import` carries a namespace attribute; `xs:include` always shares the document's own. */
  namespace: string | null;
  schemaLocation: string | null;
}

export interface SchemaDocument {
  fileId: string;
  filePath: string;
  targetNamespace: string | null;
  elementFormDefault: "qualified" | "unqualified";
  attributeFormDefault: "qualified" | "unqualified";
  /** xmlns prefix -> namespace URI declarations in scope at the `xs:schema` root. */
  namespacePrefixes: Record<string, string>;
  /** Top-level element/complexType/simpleType/group/attributeGroup/attribute declarations, in document order. */
  topLevelNodeIds: NodeId[];
  /** `xs:import` / `xs:include` directives found at the schema root, in document order. */
  imports: SchemaImportRef[];
}

export interface SchemaSet {
  documents: Record<string, SchemaDocument>;
  primaryFileId: string;
}
