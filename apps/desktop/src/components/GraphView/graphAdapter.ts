import type { DependencyEdge, DependencyGraph, NodeId, SchemaModel } from "@xsd-visualizer/core";
import type { Edge as FlowEdge, Node as FlowNode } from "@xyflow/react";

export interface GraphNodeData extends Record<string, unknown> {
  label: string;
  isCenter: boolean;
}

const EDGE_LABELS: Record<DependencyEdge["kind"], string> = {
  referencesType: "uses type",
  extends: "extends",
  restricts: "restricts",
  referencesGroup: "uses group",
  referencesAttributeGroup: "uses attrGroup",
  referencesAttribute: "uses attribute",
  referencesElement: "uses element",
  substitutesFor: "substitutes for"
};

const DASHED_KINDS: ReadonlySet<DependencyEdge["kind"]> = new Set(["restricts", "substitutesFor", "referencesElement"]);

function labelFor(model: SchemaModel, nodeId: NodeId): string {
  const node = model.getNode(nodeId);
  if (!node) return "(missing)";
  return node.name ? `${node.kind}: ${node.name}` : `(anonymous ${node.kind})`;
}

function edgeToFlow(edge: DependencyEdge): FlowEdge {
  return {
    id: `${edge.from}->${edge.to}:${edge.kind}`,
    source: edge.from,
    target: edge.to,
    label: EDGE_LABELS[edge.kind],
    style: DASHED_KINDS.has(edge.kind) ? { strokeDasharray: "4 3" } : undefined,
    animated: edge.kind === "extends"
  };
}

/**
 * Focus-mode layout (see docs/PLAN.md UI 제안): only the selected node plus its direct
 * references (outgoing, right column) and reverse references / "find usages" (incoming, left
 * column) are shown — never the whole schema graph at once, which keeps this responsive on
 * large schemas regardless of total node count.
 */
export function layoutFocusGraph(
  model: SchemaModel,
  graph: DependencyGraph,
  centerId: NodeId
): { nodes: FlowNode<GraphNodeData>[]; edges: FlowEdge[] } {
  const outgoing = graph.getReferencesFrom(centerId);
  const incoming = graph.getReferencesTo(centerId);

  const nodes: FlowNode<GraphNodeData>[] = [
    { id: centerId, position: { x: 0, y: Math.max(incoming.length, outgoing.length, 1) * 45 }, data: { label: labelFor(model, centerId), isCenter: true } }
  ];
  const placed = new Set<NodeId>([centerId]);
  const edges: FlowEdge[] = [];

  incoming.forEach((edge, i) => {
    if (!placed.has(edge.from)) {
      placed.add(edge.from);
      nodes.push({ id: edge.from, position: { x: -340, y: i * 90 }, data: { label: labelFor(model, edge.from), isCenter: false } });
    }
    edges.push(edgeToFlow(edge));
  });

  outgoing.forEach((edge, i) => {
    if (!placed.has(edge.to)) {
      placed.add(edge.to);
      nodes.push({ id: edge.to, position: { x: 340, y: i * 90 }, data: { label: labelFor(model, edge.to), isCenter: false } });
    }
    edges.push(edgeToFlow(edge));
  });

  return { nodes, edges };
}
