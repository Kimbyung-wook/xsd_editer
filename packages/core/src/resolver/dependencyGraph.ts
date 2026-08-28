import type { NodeId } from "../model/nodeId.js";

export type EdgeKind =
  | "referencesType"
  | "extends"
  | "restricts"
  | "referencesGroup"
  | "referencesAttributeGroup"
  | "referencesAttribute"
  | "referencesElement"
  | "substitutesFor";

export interface DependencyEdge {
  from: NodeId;
  to: NodeId;
  kind: EdgeKind;
}

function pushInto(map: Map<NodeId, DependencyEdge[]>, key: NodeId, edge: DependencyEdge): void {
  const list = map.get(key);
  if (list) {
    list.push(edge);
  } else {
    map.set(key, [edge]);
  }
}

/**
 * Forward + reverse adjacency over QName-resolved schema references (type refs, extension/
 * restriction, group/attributeGroup/element refs, substitution groups). Built fresh from a
 * SchemaModel by resolver/resolveReferences.ts; Phase 3 will make this incremental, recomputing
 * only edges touching an edited node instead of rebuilding on every change (see docs/PLAN.md).
 */
export class DependencyGraph {
  private readonly forward = new Map<NodeId, DependencyEdge[]>();
  private readonly reverse = new Map<NodeId, DependencyEdge[]>();

  addEdge(edge: DependencyEdge): void {
    pushInto(this.forward, edge.from, edge);
    pushInto(this.reverse, edge.to, edge);
  }

  /** Edges pointing away from `nodeId` — "what does this node reference". */
  getReferencesFrom(nodeId: NodeId): DependencyEdge[] {
    return this.forward.get(nodeId) ?? [];
  }

  /** Edges pointing at `nodeId` — "what references this node" (find usages). */
  getReferencesTo(nodeId: NodeId): DependencyEdge[] {
    return this.reverse.get(nodeId) ?? [];
  }

  /** Walks extends/restricts edges from `typeId` up to its root base type, `typeId` included first. */
  getExtensionChain(typeId: NodeId): NodeId[] {
    const chain: NodeId[] = [];
    const visited = new Set<NodeId>();
    let current: NodeId | undefined = typeId;

    while (current !== undefined && !visited.has(current)) {
      visited.add(current);
      chain.push(current);
      const next: DependencyEdge | undefined = this.forward
        .get(current)
        ?.find((edge) => edge.kind === "extends" || edge.kind === "restricts");
      current = next?.to;
    }
    return chain;
  }
}
