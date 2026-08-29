import type { SchemaModel } from "../model/schemaModel.js";
import type { NodeId } from "../model/nodeId.js";
import type { QNameRef } from "../model/types.js";
import { DependencyGraph } from "./dependencyGraph.js";

/** A named type can be either a complexType or a simpleType — XSD doesn't disambiguate by syntax. */
function resolveTypeRef(model: SchemaModel, ref: QNameRef): NodeId | undefined {
  return model.findByQName("complexType", ref.qname) ?? model.findByQName("simpleType", ref.qname);
}

/**
 * Walks every QName-valued reference in the model (type refs, extension/restriction bases,
 * group/attributeGroup/element refs, substitution groups) and resolves each against the
 * model's QName indices, producing a DependencyGraph. An unresolved reference (dangling, or
 * pointing at a built-in XSD type like `xs:string` that has no model node) simply yields no
 * edge — validation (Phase 3) is responsible for flagging dangling references as errors.
 */
export function buildDependencyGraph(model: SchemaModel): DependencyGraph {
  const graph = new DependencyGraph();

  for (const node of model.allNodes()) {
    switch (node.kind) {
      case "element": {
        if (node.typeRef !== null && typeof node.typeRef === "object") {
          const target = resolveTypeRef(model, node.typeRef);
          if (target) graph.addEdge({ from: node.id, to: target, kind: "referencesType" });
        }
        if (node.substitutionGroupRef) {
          const target = model.findByQName("element", node.substitutionGroupRef.qname);
          if (target) graph.addEdge({ from: node.id, to: target, kind: "substitutesFor" });
        }
        break;
      }
      case "elementRef": {
        const target = model.findByQName("element", node.ref.qname);
        if (target) graph.addEdge({ from: node.id, to: target, kind: "referencesElement" });
        break;
      }
      case "groupRef": {
        const target = model.findByQName("group", node.ref.qname);
        if (target) graph.addEdge({ from: node.id, to: target, kind: "referencesGroup" });
        break;
      }
      case "complexType": {
        if (node.derivation) {
          const target = resolveTypeRef(model, node.derivation.baseRef);
          if (target) {
            graph.addEdge({ from: node.id, to: target, kind: node.derivation.kind === "extension" ? "extends" : "restricts" });
          }
        }
        for (const ref of node.attributeGroupRefs) {
          const target = model.findByQName("attributeGroup", ref.qname);
          if (target) graph.addEdge({ from: node.id, to: target, kind: "referencesAttributeGroup" });
        }
        break;
      }
      case "simpleType": {
        if (node.variant === "list") {
          if (node.itemTypeRef) {
            const target = model.findByQName("simpleType", node.itemTypeRef.qname);
            if (target) graph.addEdge({ from: node.id, to: target, kind: "referencesType" });
          }
        } else if (node.variant === "union") {
          for (const ref of node.memberTypeRefs) {
            const target = model.findByQName("simpleType", ref.qname);
            if (target) graph.addEdge({ from: node.id, to: target, kind: "referencesType" });
          }
        } else if (node.baseRef) {
          const target = model.findByQName("simpleType", node.baseRef.qname);
          if (target) graph.addEdge({ from: node.id, to: target, kind: "restricts" });
        }
        break;
      }
      case "attributeGroup": {
        for (const ref of node.attributeGroupRefs) {
          const target = model.findByQName("attributeGroup", ref.qname);
          if (target) graph.addEdge({ from: node.id, to: target, kind: "referencesAttributeGroup" });
        }
        break;
      }
      case "attribute": {
        if (node.ref) {
          const target = model.findByQName("attribute", node.ref.qname);
          if (target) graph.addEdge({ from: node.id, to: target, kind: "referencesAttribute" });
        } else if (node.typeRef !== null && typeof node.typeRef === "object") {
          const target = model.findByQName("simpleType", node.typeRef.qname);
          if (target) graph.addEdge({ from: node.id, to: target, kind: "referencesType" });
        }
        break;
      }
      default:
        break;
    }
  }

  return graph;
}
