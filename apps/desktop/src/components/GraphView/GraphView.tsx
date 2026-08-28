import { useMemo } from "react";
import { Background, Controls, MiniMap, ReactFlow, type Node as FlowNode, type NodeMouseHandler } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { buildDependencyGraph, type NodeId } from "@xsd-visualizer/core";
import { useSchemaStore } from "../../state/schemaStore.js";
import { layoutFocusGraph, type GraphNodeData } from "./graphAdapter.js";

type FlowGraphNode = FlowNode<GraphNodeData>;

/**
 * Reference/dependency graph, focus-mode only (see docs/PLAN.md) — centers on the tree's
 * current selection and shows just its direct references and reverse references ("find
 * usages"). A "show full graph" mode is deferred; focus mode alone keeps this responsive
 * regardless of total schema size, which matters more for the 8MB/150k-line target schema.
 */
export function GraphView() {
  const model = useSchemaStore((state) => state.model);
  // `model` mutates in place (see schemaStore.ts) so `revision` is what actually changes on
  // every edit; it must be a dependency below or these memos would keep a stale graph/layout.
  const revision = useSchemaStore((state) => state.revision);
  const selectedNodeId = useSchemaStore((state) => state.selectedNodeId);
  const select = useSchemaStore((state) => state.select);

  const dependencyGraph = useMemo(() => buildDependencyGraph(model), [model, revision]);

  const { nodes, edges } = useMemo<{ nodes: FlowGraphNode[]; edges: import("@xyflow/react").Edge[] }>(() => {
    if (!selectedNodeId || !model.getNode(selectedNodeId)) return { nodes: [], edges: [] };
    return layoutFocusGraph(model, dependencyGraph, selectedNodeId);
  }, [model, dependencyGraph, selectedNodeId]);

  const onNodeClick: NodeMouseHandler<FlowGraphNode> = (_event, node) => select(node.id as NodeId);

  if (!selectedNodeId || !model.getNode(selectedNodeId)) {
    return (
      <div className="panel__body panel__body--empty">
        트리에서 노드를 선택하면 해당 노드의 참조/역참조 그래프가 여기 표시됩니다.
      </div>
    );
  }

  return (
    <div className="graph-view">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodeClick={onNodeClick}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        fitView
        fitViewOptions={{ padding: 0.3 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable />
      </ReactFlow>
    </div>
  );
}
