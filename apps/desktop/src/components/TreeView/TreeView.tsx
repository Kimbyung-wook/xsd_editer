import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Tree, type NodeApi, type NodeRendererProps } from "react-arborist";
import { AddChildCommand, RemoveChildCommand, SetFieldCommand, compositorParticles, complexTypeAttributes } from "@xsd-visualizer/core";
import type { CompositorNode, ComplexTypeDecl } from "@xsd-visualizer/core";
import { useSchemaStore } from "../../state/schemaStore.js";
import { buildTreeRows, type TreeRow } from "./treeAdapter.js";
import { makeDefaultAny, makeDefaultAttribute, makeDefaultElement } from "./nodeFactories.js";
import { TreeContextMenu, type ContextMenuAction } from "./TreeContextMenu.js";

function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { ref, ...size };
}

const TreeActionsContext = createContext<{ openMenu: (x: number, y: number, row: TreeRow) => void } | null>(null);

function TreeRowRenderer({ node, style, dragHandle }: NodeRendererProps<TreeRow>) {
  const actions = useContext(TreeActionsContext);
  return (
    <div
      ref={dragHandle}
      style={style}
      className={node.isSelected ? "tree-row tree-row--selected" : "tree-row"}
      onClick={node.handleClick}
      onDoubleClick={() => {
        if (node.isEditable) void node.edit();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        node.select();
        actions?.openMenu(event.clientX, event.clientY, node.data);
      }}
    >
      <span
        className="tree-row__toggle"
        onClick={(event) => {
          event.stopPropagation();
          node.toggle();
        }}
      >
        {node.isLeaf ? "" : node.isOpen ? "▾" : "▸"}
      </span>
      {node.isEditing ? (
        <input
          className="tree-row__rename-input"
          autoFocus
          defaultValue={node.data.label.split(":")[0].trim()}
          onBlur={(e) => node.submit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") node.submit((e.target as HTMLInputElement).value);
            if (e.key === "Escape") node.reset();
          }}
        />
      ) : (
        <span className="tree-row__label">{node.data.label}</span>
      )}
      {node.data.badge && <span className="tree-row__badge">{node.data.badge}</span>}
    </div>
  );
}

/** Editable containment tree (Phase 3): inline rename, add element/attribute, delete — via react-arborist. */
export function TreeView() {
  const model = useSchemaStore((state) => state.model);
  const revision = useSchemaStore((state) => state.revision);
  const isLoading = useSchemaStore((state) => state.isLoading);
  const loadError = useSchemaStore((state) => state.loadError);
  const selectedNodeId = useSchemaStore((state) => state.selectedNodeId);
  const select = useSchemaStore((state) => state.select);
  const { ref, width, height } = useElementSize<HTMLDivElement>();
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; row: TreeRow } | null>(null);

  // `model` mutates in place (see schemaStore.ts) so `revision` — not `model` — is what actually
  // changes on every edit; it must be a dependency here or this memo would keep stale rows.
  const rows = useMemo(() => buildTreeRows(model), [model, revision]);

  const treeActions = useMemo(
    () => ({ openMenu: (x: number, y: number, row: TreeRow) => setContextMenu({ x, y, row }) }),
    []
  );

  const menuActions: ContextMenuAction[] = [];
  if (contextMenu?.row.canAddElement && contextMenu.row.nodeId) {
    const parentId = contextMenu.row.nodeId;
    menuActions.push({
      label: "새 요소 추가",
      onSelect: () =>
        useSchemaStore
          .getState()
          .dispatch(new AddChildCommand<CompositorNode>(parentId, compositorParticles, "element", makeDefaultElement, null, "요소 추가"))
    });
  }
  if (contextMenu?.row.canAddAny && contextMenu.row.nodeId) {
    const parentId = contextMenu.row.nodeId;
    menuActions.push({
      label: "새 와일드카드(xs:any) 추가",
      onSelect: () =>
        useSchemaStore
          .getState()
          .dispatch(new AddChildCommand<CompositorNode>(parentId, compositorParticles, "any", makeDefaultAny, null, "와일드카드 추가"))
    });
  }
  if (contextMenu?.row.canAddAttribute && contextMenu.row.nodeId) {
    const parentId = contextMenu.row.nodeId;
    menuActions.push({
      label: "새 속성 추가",
      onSelect: () =>
        useSchemaStore
          .getState()
          .dispatch(
            new AddChildCommand<ComplexTypeDecl>(parentId, complexTypeAttributes, "attribute", makeDefaultAttribute, null, "속성 추가")
          )
    });
  }
  if (contextMenu?.row.deleteTarget && contextMenu.row.nodeId) {
    const { parentId, field } = contextMenu.row.deleteTarget;
    const childId = contextMenu.row.nodeId;
    const label = contextMenu.row.label;
    menuActions.push({
      label: `삭제: ${label}`,
      onSelect: () => {
        const command =
          field === "particles"
            ? new RemoveChildCommand<CompositorNode>(parentId, compositorParticles, childId, `삭제: ${label}`)
            : new RemoveChildCommand<ComplexTypeDecl>(parentId, complexTypeAttributes, childId, `삭제: ${label}`);
        useSchemaStore.getState().dispatch(command);
      }
    });
  }

  return (
    <div className="panel panel--tree">
      <div className="panel__header">트리 (Containment)</div>
      <div className="panel__body panel__body--tree" ref={ref}>
        {loadError && <div className="panel__body--error">파싱 실패: {loadError}</div>}
        {isLoading && <div className="panel__body--empty">파싱 중...</div>}
        {!isLoading && !loadError && rows.length === 0 && (
          <div className="panel__body--empty">XSD 파일을 열면 여기에 트리가 표시됩니다.</div>
        )}
        {!isLoading && rows.length > 0 && width > 0 && height > 0 && (
          <TreeActionsContext.Provider value={treeActions}>
            <Tree<TreeRow>
              data={rows}
              width={width}
              height={height}
              indent={16}
              rowHeight={24}
              openByDefault={false}
              disableDrag
              disableEdit={(row) => !row.editable}
              selection={selectedNodeId ?? undefined}
              onSelect={(nodes: NodeApi<TreeRow>[]) => select(nodes[0]?.data.nodeId ?? null)}
              onRename={({ id, name }) => {
                const row = findRow(rows, id);
                if (!row?.nodeId) return;
                const trimmed = name.trim();
                const current = model.getNode(row.nodeId);
                if (!trimmed || current?.name === trimmed) return;
                useSchemaStore.getState().dispatch(new SetFieldCommand(row.nodeId, (n) => ({ ...n, name: trimmed }), "이름 변경"));
              }}
            >
              {TreeRowRenderer}
            </Tree>
          </TreeActionsContext.Provider>
        )}
      </div>
      {contextMenu && (
        <TreeContextMenu x={contextMenu.x} y={contextMenu.y} actions={menuActions} onClose={() => setContextMenu(null)} />
      )}
    </div>
  );
}

function findRow(rows: TreeRow[], id: string): TreeRow | undefined {
  for (const row of rows) {
    if (row.id === id) return row;
    if (row.children) {
      const found = findRow(row.children, id);
      if (found) return found;
    }
  }
  return undefined;
}
