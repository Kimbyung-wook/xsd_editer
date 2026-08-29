import type { AnyNode, AttributeDecl, ElementDecl, NodeId } from "@xsd-visualizer/core";

const XSD_STRING = { qname: { namespaceURI: "http://www.w3.org/2001/XMLSchema", localName: "string" }, resolvedTargetId: null };

export function makeDefaultElement(id: NodeId): ElementDecl {
  return {
    id,
    kind: "element",
    name: "newElement",
    namespaceURI: null,
    annotation: null,
    sourceRef: null,
    typeRef: { ...XSD_STRING },
    minOccurs: 1,
    maxOccurs: 1,
    nillable: false,
    default: null,
    fixed: null,
    abstract: false,
    substitutionGroupRef: null
  };
}

export function makeDefaultAny(id: NodeId): AnyNode {
  return {
    id,
    kind: "any",
    name: null,
    namespaceURI: null,
    annotation: null,
    sourceRef: null,
    namespace: "##any",
    processContents: "strict",
    minOccurs: 0,
    maxOccurs: 1
  };
}

export function makeDefaultAttribute(id: NodeId): AttributeDecl {
  return {
    id,
    kind: "attribute",
    name: "newAttribute",
    namespaceURI: null,
    annotation: null,
    sourceRef: null,
    ref: null,
    typeRef: { ...XSD_STRING },
    use: "optional",
    default: null,
    fixed: null
  };
}
