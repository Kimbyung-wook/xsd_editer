import { nextId, type SchemaModel } from "../model/schemaModel.js";
import type { NodeId } from "../model/nodeId.js";
import type { ComplexTypeDecl, CompositorNode, SchemaNode, SchemaNodeKind } from "../model/types.js";
import type { Command } from "./command.js";

/** Reads/writes the ordered NodeId list a container node owns (a compositor's particles, a complexType's attributes). */
export interface ListFieldAccessor<P extends SchemaNode> {
  get(parent: P): NodeId[];
  set(parent: P, ids: NodeId[]): P;
}

export const compositorParticles: ListFieldAccessor<CompositorNode> = {
  get: (p) => p.particleIds,
  set: (p, ids) => ({ ...p, particleIds: ids })
};

export const complexTypeAttributes: ListFieldAccessor<ComplexTypeDecl> = {
  get: (p) => p.attributeIds,
  set: (p, ids) => ({ ...p, attributeIds: ids })
};

/**
 * Walks a node's own structural (containment) children — never QName references — so deleting
 * it doesn't leave orphaned-but-still-indexed nodes behind in the model. This only ever follows
 * ownership edges (compositor particles, inline anonymous types, attribute lists), which by
 * construction cannot cycle (see parser/domToModel.ts).
 */
export function collectDescendants(model: SchemaModel, id: NodeId): SchemaNode[] {
  const node = model.getNode(id);
  if (!node) return [];

  const childIds: NodeId[] = [];
  switch (node.kind) {
    case "element":
      if (typeof node.typeRef === "string") childIds.push(node.typeRef);
      break;
    case "compositor":
      childIds.push(...node.particleIds);
      break;
    case "complexType":
      if (node.contentModelId) childIds.push(node.contentModelId);
      childIds.push(...node.attributeIds);
      break;
    case "group":
      if (node.contentModelId) childIds.push(node.contentModelId);
      break;
    case "attributeGroup":
      childIds.push(...node.attributeIds);
      break;
    default:
      break;
  }

  const result: SchemaNode[] = [];
  for (const childId of childIds) {
    const child = model.getNode(childId);
    if (child) {
      result.push(child, ...collectDescendants(model, childId));
    }
  }
  return result;
}

/** Inserts a freshly created node into a parent's owned list (compositor particles, complexType attributes, ...). */
export class AddChildCommand<P extends SchemaNode> implements Command {
  private createdId: NodeId | undefined;

  constructor(
    private readonly parentId: NodeId,
    private readonly field: ListFieldAccessor<P>,
    private readonly idPrefix: SchemaNodeKind,
    private readonly factory: (id: NodeId) => SchemaNode,
    private readonly index: number | null,
    private readonly label: string
  ) {}

  apply(model: SchemaModel): void {
    const parent = model.getNode(this.parentId) as P | undefined;
    if (!parent) throw new Error(`AddChildCommand: parent ${this.parentId} not found`);

    if (!this.createdId) {
      this.createdId = nextId(this.idPrefix);
    }
    model.addNode(this.factory(this.createdId));

    const ids = [...this.field.get(parent)];
    ids.splice(this.index ?? ids.length, 0, this.createdId);
    model.updateNode<P>(this.parentId, (p) => this.field.set(p, ids));
  }

  invert(): Command {
    if (!this.createdId) throw new Error("AddChildCommand.invert(): apply() must run first");
    return new RemoveChildCommand(this.parentId, this.field, this.createdId, `실행 취소: ${this.label}`);
  }

  describe(): string {
    return this.label;
  }
}

/** Removes a child from a parent's owned list and cascades to the child's own structural descendants. */
export class RemoveChildCommand<P extends SchemaNode> implements Command {
  private removedIndex = -1;
  private removedNode: SchemaNode | undefined;
  private removedDescendants: SchemaNode[] = [];

  constructor(
    private readonly parentId: NodeId,
    private readonly field: ListFieldAccessor<P>,
    private readonly childId: NodeId,
    private readonly label: string
  ) {}

  apply(model: SchemaModel): void {
    const parent = model.getNode(this.parentId) as P | undefined;
    if (!parent) throw new Error(`RemoveChildCommand: parent ${this.parentId} not found`);

    const ids = this.field.get(parent);
    this.removedIndex = ids.indexOf(this.childId);
    if (this.removedIndex === -1) {
      throw new Error(`RemoveChildCommand: ${this.childId} is not a child of ${this.parentId}`);
    }
    this.removedNode = model.getNode(this.childId);
    this.removedDescendants = collectDescendants(model, this.childId);

    model.updateNode<P>(this.parentId, (p) => this.field.set(p, ids.filter((id) => id !== this.childId)));
    model.removeNode(this.childId);
    for (const descendant of this.removedDescendants) {
      model.removeNode(descendant.id);
    }
  }

  invert(): Command {
    if (!this.removedNode) throw new Error("RemoveChildCommand.invert(): apply() must run first");
    return new RestoreChildCommand(
      this.parentId,
      this.field,
      this.removedIndex,
      this.removedNode,
      this.removedDescendants,
      `실행 취소: ${this.label}`
    );
  }

  describe(): string {
    return this.label;
  }
}

class RestoreChildCommand<P extends SchemaNode> implements Command {
  constructor(
    private readonly parentId: NodeId,
    private readonly field: ListFieldAccessor<P>,
    private readonly index: number,
    private readonly node: SchemaNode,
    private readonly descendants: SchemaNode[],
    private readonly label: string
  ) {}

  apply(model: SchemaModel): void {
    model.addNode(this.node);
    for (const descendant of this.descendants) {
      model.addNode(descendant);
    }
    const parent = model.getNode(this.parentId) as P;
    const ids = [...this.field.get(parent)];
    ids.splice(this.index, 0, this.node.id);
    model.updateNode<P>(this.parentId, (p) => this.field.set(p, ids));
  }

  invert(): Command {
    return new RemoveChildCommand(this.parentId, this.field, this.node.id, this.label);
  }

  describe(): string {
    return this.label;
  }
}
