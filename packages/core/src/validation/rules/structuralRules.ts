import type { SchemaModel } from "../../model/schemaModel.js";
import type { NodeId } from "../../model/nodeId.js";
import type { QName, QNameRef } from "../../model/types.js";
import type { Diagnostic } from "../diagnostic.js";

const XSD_NAMESPACE = "http://www.w3.org/2001/XMLSchema";

function isBuiltInXsdType(qname: QName): boolean {
  return qname.namespaceURI === XSD_NAMESPACE;
}

/** A named type can be either a complexType or a simpleType — XSD doesn't disambiguate by syntax. */
function resolveTypeRef(model: SchemaModel, ref: QNameRef): NodeId | undefined {
  return model.findByQName("complexType", ref.qname) ?? model.findByQName("simpleType", ref.qname);
}

function checkDangling(
  model: SchemaModel,
  fromId: NodeId,
  ref: QNameRef | null,
  resolve: (ref: QNameRef) => NodeId | undefined,
  diagnostics: Diagnostic[]
): void {
  if (!ref || isBuiltInXsdType(ref.qname)) return;
  if (resolve(ref) === undefined) {
    const label = ref.qname.namespaceURI ? `{${ref.qname.namespaceURI}}${ref.qname.localName}` : ref.qname.localName;
    diagnostics.push({
      severity: "error",
      code: "dangling-reference",
      nodeId: fromId,
      message: `참조를 찾을 수 없습니다: ${label}`
    });
  }
}

/** Required-name, dangling-reference, duplicate-top-level-name, and xs:all cardinality checks. */
export function checkStructuralRules(model: SchemaModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const schemaSet = model.getSchemaSet();

  // required name + duplicate name (within the same kind+namespace) on top-level declarations
  if (schemaSet) {
    const seen = new Map<string, NodeId>();
    for (const doc of Object.values(schemaSet.documents)) {
      for (const nodeId of doc.topLevelNodeIds) {
        const node = model.getNode(nodeId);
        if (!node) continue;
        if (node.name === null) {
          diagnostics.push({ severity: "error", code: "missing-name", nodeId, message: "최상위 선언에는 이름이 필요합니다." });
          continue;
        }
        const key = `${node.kind}#${node.namespaceURI ?? ""}#${node.name}`;
        const existing = seen.get(key);
        if (existing) {
          diagnostics.push({
            severity: "error",
            code: "duplicate-name",
            nodeId,
            message: `이름이 중복됩니다: ${node.name} (다른 위치에서도 같은 이름의 ${node.kind}가 선언됨)`
          });
        } else {
          seen.set(key, nodeId);
        }
      }
    }
  }

  // dangling references + xs:all cardinality
  for (const node of model.allNodes()) {
    switch (node.kind) {
      case "element":
        if (node.typeRef !== null && typeof node.typeRef === "object") {
          checkDangling(model, node.id, node.typeRef, (ref) => resolveTypeRef(model, ref), diagnostics);
        }
        checkDangling(model, node.id, node.substitutionGroupRef, (ref) => model.findByQName("element", ref.qname), diagnostics);
        break;
      case "elementRef":
        checkDangling(model, node.id, node.ref, (ref) => model.findByQName("element", ref.qname), diagnostics);
        break;
      case "groupRef":
        checkDangling(model, node.id, node.ref, (ref) => model.findByQName("group", ref.qname), diagnostics);
        break;
      case "complexType":
        if (node.derivation) {
          checkDangling(model, node.id, node.derivation.baseRef, (ref) => resolveTypeRef(model, ref), diagnostics);
        }
        for (const ref of node.attributeGroupRefs) {
          checkDangling(model, node.id, ref, (r) => model.findByQName("attributeGroup", r.qname), diagnostics);
        }
        break;
      case "simpleType":
        checkDangling(model, node.id, node.baseRef, (ref) => model.findByQName("simpleType", ref.qname), diagnostics);
        break;
      case "attributeGroup":
        for (const ref of node.attributeGroupRefs) {
          checkDangling(model, node.id, ref, (r) => model.findByQName("attributeGroup", r.qname), diagnostics);
        }
        break;
      case "attribute":
        if (node.ref) {
          checkDangling(model, node.id, node.ref, (ref) => model.findByQName("attribute", ref.qname), diagnostics);
        } else if (node.typeRef !== null && typeof node.typeRef === "object") {
          checkDangling(model, node.id, node.typeRef, (ref) => model.findByQName("simpleType", ref.qname), diagnostics);
        }
        break;
      case "compositor":
        if (node.compositor === "all") {
          for (const particleId of node.particleIds) {
            const particle = model.getNode(particleId);
            if (
              particle &&
              (particle.kind === "element" || particle.kind === "elementRef") &&
              particle.maxOccurs !== 1 &&
              particle.maxOccurs !== 0
            ) {
              diagnostics.push({
                severity: "error",
                code: "invalid-all-cardinality",
                nodeId: particleId,
                message: "xs:all의 자식은 maxOccurs가 0 또는 1이어야 합니다."
              });
            }
          }
        }
        break;
      default:
        break;
    }
  }

  // cyclic extension/restriction
  for (const node of model.allNodes()) {
    if (node.kind !== "complexType" || !node.derivation) continue;
    const visited = new Set<NodeId>([node.id]);
    let current = resolveTypeRef(model, node.derivation.baseRef);
    while (current !== undefined) {
      if (visited.has(current)) {
        diagnostics.push({ severity: "error", code: "cyclic-derivation", nodeId: node.id, message: "타입 상속(extension/restriction)에 순환 참조가 있습니다." });
        break;
      }
      visited.add(current);
      const currentNode = model.getNode(current);
      current = currentNode?.kind === "complexType" && currentNode.derivation ? resolveTypeRef(model, currentNode.derivation.baseRef) : undefined;
    }
  }

  return diagnostics;
}
