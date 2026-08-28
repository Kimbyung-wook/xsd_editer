export type NodeId = string & { readonly __brand: "NodeId" };

let counter = 0;

export function createNodeId(prefix: string): NodeId {
  counter += 1;
  return `${prefix}:${counter}` as NodeId;
}
