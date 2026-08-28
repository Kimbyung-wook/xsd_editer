import type { NodeId, QNameRef, SchemaModel } from "@xsd-visualizer/core";

export type DeleteField = "particles" | "attributes";

export interface TreeRow {
  id: string;
  label: string;
  badge: string | null;
  nodeId: NodeId | null;
  /** Whether react-arborist's inline rename (F2/double-click) should be allowed for this row. */
  editable: boolean;
  /** Whether "새 요소 추가" (add a compositor particle) applies to this row. */
  canAddElement: boolean;
  /** Whether "새 속성 추가" (add an attribute) applies to this row. */
  canAddAttribute: boolean;
  /** Present when this row can be removed from its parent's list — which list, and via which parent. */
  deleteTarget: { parentId: NodeId; field: DeleteField } | null;
  children?: TreeRow[];
}

function occursBadge(min: number, max: number | "unbounded"): string {
  return `${min}..${max === "unbounded" ? "*" : max}`;
}

function qnameText(ref: QNameRef): string {
  return ref.qname.localName;
}

/** Renders an element/attribute's type reference as short display text (named ref or "(inline)"). */
function describeTypeRef(typeRef: NodeId | QNameRef | null): string {
  if (typeRef === null) return "";
  if (typeof typeRef === "object" && "qname" in typeRef) {
    return `: ${qnameText(typeRef)}`;
  }
  return ": (inline)";
}

function isInlineTypeRef(typeRef: NodeId | QNameRef | null): typeRef is NodeId {
  return typeof typeRef === "string";
}

function baseRow(id: string, nodeId: NodeId | null): Omit<TreeRow, "label" | "badge"> {
  return { id, nodeId, editable: false, canAddElement: false, canAddAttribute: false, deleteTarget: null };
}

function refRow(prefix: string, ref: QNameRef, keyHint: string): TreeRow {
  return {
    ...baseRow(`${keyHint}:ref:${ref.qname.namespaceURI ?? ""}#${ref.qname.localName}`, null),
    label: `${prefix} ref: ${qnameText(ref)}`,
    badge: null
  };
}

/** Tags a built child row with how to remove it from its parent's owned list. */
function withDeleteTarget(row: TreeRow, parentId: NodeId, field: DeleteField): TreeRow {
  return row.nodeId ? { ...row, deleteTarget: { parentId, field } } : row;
}

function buildRow(model: SchemaModel, id: NodeId): TreeRow {
  const node = model.getNode(id);
  if (!node) {
    return { ...baseRow(id, id), label: "(missing node)", badge: null };
  }

  switch (node.kind) {
    case "element": {
      const children: TreeRow[] = [];
      if (isInlineTypeRef(node.typeRef)) {
        children.push(buildRow(model, node.typeRef));
      }
      return {
        ...baseRow(id, id),
        editable: true,
        label: `${node.name ?? "(anonymous)"}${describeTypeRef(node.typeRef)}`,
        badge: occursBadge(node.minOccurs, node.maxOccurs),
        children: children.length > 0 ? children : undefined
      };
    }
    case "elementRef":
      return {
        ...baseRow(id, id),
        label: `element ref: ${qnameText(node.ref)}`,
        badge: occursBadge(node.minOccurs, node.maxOccurs)
      };
    case "groupRef":
      return {
        ...baseRow(id, id),
        label: `group ref: ${qnameText(node.ref)}`,
        badge: occursBadge(node.minOccurs, node.maxOccurs)
      };
    case "compositor": {
      const children = node.particleIds.map((particleId) => withDeleteTarget(buildRow(model, particleId), id, "particles"));
      return {
        ...baseRow(id, id),
        canAddElement: true,
        label: node.compositor,
        badge: occursBadge(node.minOccurs, node.maxOccurs),
        children: children.length > 0 ? children : undefined
      };
    }
    case "complexType": {
      const children: TreeRow[] = [];
      if (node.contentModelId) children.push(buildRow(model, node.contentModelId));
      for (const attrId of node.attributeIds) {
        children.push(withDeleteTarget(buildRow(model, attrId), id, "attributes"));
      }
      for (const ref of node.attributeGroupRefs) children.push(refRow("attributeGroup", ref, id));
      return {
        ...baseRow(id, id),
        editable: true,
        canAddAttribute: true,
        label: node.name ?? "(anonymous complexType)",
        badge: node.abstract ? "abstract" : null,
        children: children.length > 0 ? children : undefined
      };
    }
    case "simpleType":
      return {
        ...baseRow(id, id),
        editable: true,
        label: node.name ?? "(anonymous simpleType)",
        badge: node.baseRef ? qnameText(node.baseRef) : null
      };
    case "group": {
      const children = node.contentModelId ? [buildRow(model, node.contentModelId)] : [];
      return {
        ...baseRow(id, id),
        editable: true,
        label: node.name ?? "(group)",
        badge: null,
        children: children.length > 0 ? children : undefined
      };
    }
    case "attributeGroup": {
      const children = node.attributeIds.map((attrId) => withDeleteTarget(buildRow(model, attrId), id, "attributes"));
      for (const ref of node.attributeGroupRefs) children.push(refRow("attributeGroup", ref, id));
      return {
        ...baseRow(id, id),
        editable: true,
        label: node.name ?? "(attributeGroup)",
        badge: null,
        children: children.length > 0 ? children : undefined
      };
    }
    case "attribute": {
      const label = node.ref ? `attribute ref: ${qnameText(node.ref)}` : `${node.name ?? "(anonymous)"}${describeTypeRef(node.typeRef)}`;
      return { ...baseRow(id, id), editable: !node.ref, label, badge: node.use !== "optional" ? node.use : null };
    }
    default:
      return { ...baseRow(id, id), label: "(unknown node)", badge: null };
  }
}

/** Builds the full containment tree (one root per document) from a parsed SchemaModel. */
export function buildTreeRows(model: SchemaModel): TreeRow[] {
  const schemaSet = model.getSchemaSet();
  if (!schemaSet) return [];

  return Object.values(schemaSet.documents).map((doc) => ({
    ...baseRow(`doc:${doc.fileId}`, null),
    label: doc.filePath,
    badge: doc.targetNamespace,
    children: doc.topLevelNodeIds.map((nodeId) => buildRow(model, nodeId))
  }));
}
