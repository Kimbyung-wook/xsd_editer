import { createNodeId, type NodeId } from "./nodeId.js";
import type { QName, SchemaNode, SchemaNodeKind, SchemaSet } from "./types.js";

export type SchemaChangeEvent =
  | { type: "added"; nodeId: NodeId }
  | { type: "updated"; nodeId: NodeId }
  | { type: "removed"; nodeId: NodeId };

export type SchemaChangeListener = (event: SchemaChangeEvent) => void;

function qnameKey(qname: QName): string {
  return `${qname.namespaceURI ?? ""}#${qname.localName}`;
}

/**
 * Normalized entity store: every schema node lives in one map keyed by NodeId,
 * with secondary indices by (kind, QName) for reference resolution and by-kind lookups
 * used by both the tree UI and the dependency resolver.
 */
export class SchemaModel {
  private readonly nodes = new Map<NodeId, SchemaNode>();
  private readonly byQName = new Map<SchemaNodeKind, Map<string, NodeId>>();
  private readonly listeners = new Set<SchemaChangeListener>();
  private schemaSet: SchemaSet | null = null;

  setSchemaSet(schemaSet: SchemaSet): void {
    this.schemaSet = schemaSet;
  }

  getSchemaSet(): SchemaSet | null {
    return this.schemaSet;
  }

  addNode(node: SchemaNode): NodeId {
    this.nodes.set(node.id, node);
    if (node.name !== null) {
      this.indexByQName(node);
    }
    this.emit({ type: "added", nodeId: node.id });
    return node.id;
  }

  getNode(id: NodeId): SchemaNode | undefined {
    return this.nodes.get(id);
  }

  updateNode<T extends SchemaNode>(id: NodeId, updater: (node: T) => T): void {
    const existing = this.nodes.get(id) as T | undefined;
    if (!existing) {
      throw new Error(`SchemaModel.updateNode: no node with id ${id}`);
    }
    this.deindexByQName(existing);
    const updated = updater(existing);
    this.nodes.set(id, updated);
    if (updated.name !== null) {
      this.indexByQName(updated);
    }
    this.emit({ type: "updated", nodeId: id });
  }

  removeNode(id: NodeId): void {
    const existing = this.nodes.get(id);
    if (!existing) return;
    this.deindexByQName(existing);
    this.nodes.delete(id);
    this.emit({ type: "removed", nodeId: id });
  }

  findByQName(kind: SchemaNodeKind, qname: QName): NodeId | undefined {
    return this.byQName.get(kind)?.get(qnameKey(qname));
  }

  allNodes(): IterableIterator<SchemaNode> {
    return this.nodes.values();
  }

  onChange(listener: SchemaChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private indexByQName(node: SchemaNode): void {
    if (node.name === null) return;
    let index = this.byQName.get(node.kind);
    if (!index) {
      index = new Map();
      this.byQName.set(node.kind, index);
    }
    // namespaceURI is populated by the parser (domToModel.ts, Phase 1) from the owning
    // document's targetNamespace; nodes created ad hoc before that wiring stay in the
    // null-namespace bucket, which is fine for the model-layer unit tests in this phase.
    const qname: QName = { namespaceURI: node.namespaceURI ?? null, localName: node.name };
    index.set(qnameKey(qname), node.id);
  }

  /** Removes `node`'s own QName index entry — but only if it still points at `node` (a duplicate-name collision keeps the other entry intact). */
  private deindexByQName(node: SchemaNode): void {
    if (node.name === null) return;
    const index = this.byQName.get(node.kind);
    if (!index) return;
    const key = qnameKey({ namespaceURI: node.namespaceURI ?? null, localName: node.name });
    if (index.get(key) === node.id) {
      index.delete(key);
    }
  }

  private emit(event: SchemaChangeEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

export function nextId(prefix: SchemaNodeKind): NodeId {
  return createNodeId(prefix);
}
