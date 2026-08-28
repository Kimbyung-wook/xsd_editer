import type { NodeId } from "../model/nodeId.js";
import type { SchemaModel } from "../model/schemaModel.js";
import type { SchemaNode } from "../model/types.js";
import type { Command } from "./command.js";

/**
 * Generic scalar-field edit: covers rename, minOccurs/maxOccurs, nillable, default/fixed,
 * abstract/mixed, facets, type-ref rewiring — every Property Panel field (see docs/PLAN.md
 * "속성 패널") is one node object replaced by `updater`. A single generic command instead of
 * one class per field (RenameNodeCommand/SetFacetCommand/ChangeTypeRefCommand/...) avoids
 * near-duplicate boilerplate; `label` is only for the undo-history description.
 */
export class SetFieldCommand<T extends SchemaNode = SchemaNode> implements Command {
  private previousNode: T | undefined;

  constructor(
    private readonly nodeId: NodeId,
    private readonly updater: (node: T) => T,
    private readonly label: string
  ) {}

  apply(model: SchemaModel): void {
    const current = model.getNode(this.nodeId) as T | undefined;
    if (!current) {
      throw new Error(`SetFieldCommand: no node with id ${this.nodeId}`);
    }
    this.previousNode = current;
    model.updateNode<T>(this.nodeId, this.updater);
  }

  invert(): Command {
    if (this.previousNode === undefined) {
      throw new Error("SetFieldCommand.invert(): apply() must run first");
    }
    const snapshot = this.previousNode;
    return new SetFieldCommand<T>(this.nodeId, () => snapshot, `Undo: ${this.label}`);
  }

  describe(): string {
    return this.label;
  }
}
