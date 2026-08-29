import { SetFieldCommand, type GroupDecl, type AttributeGroupDecl } from "@xsd-visualizer/core";
import { useSchemaStore } from "../../state/schemaStore.js";
import { ElementForm } from "./forms/ElementForm.js";
import { ComplexTypeForm } from "./forms/ComplexTypeForm.js";
import { SimpleTypeForm } from "./forms/SimpleTypeForm.js";
import { AttributeForm } from "./forms/AttributeForm.js";
import { AnyForm } from "./forms/AnyForm.js";
import { TextField } from "./forms/fields.js";

/** Editable property inspector (Phase 3) — one form per node kind, dispatching SetFieldCommand. */
export function PropertyPanel() {
  const model = useSchemaStore((state) => state.model);
  useSchemaStore((state) => state.revision);
  const selectedNodeId = useSchemaStore((state) => state.selectedNodeId);
  const dispatch = useSchemaStore((state) => state.dispatch);
  const node = selectedNodeId ? model.getNode(selectedNodeId) : undefined;

  return (
    <div className="panel panel--properties">
      <div className="panel__header">속성 인스펙터</div>
      <div className="panel__body">
        {!node && <div className="panel__body--empty">노드를 선택하면 속성이 표시됩니다.</div>}
        {node?.kind === "element" && <ElementForm node={node} model={model} />}
        {node?.kind === "complexType" && <ComplexTypeForm node={node} />}
        {node?.kind === "simpleType" && <SimpleTypeForm node={node} model={model} />}
        {node?.kind === "attribute" && <AttributeForm node={node} model={model} />}
        {node?.kind === "any" && <AnyForm node={node} />}
        {node?.kind === "group" && (
          <div className="property-form">
            <TextField
              label="이름"
              value={node.name ?? ""}
              onCommit={(v) => dispatch(new SetFieldCommand<GroupDecl>(node.id, (n) => ({ ...n, name: v || null }), "이름 변경"))}
            />
          </div>
        )}
        {node?.kind === "attributeGroup" && (
          <div className="property-form">
            <TextField
              label="이름"
              value={node.name ?? ""}
              onCommit={(v) => dispatch(new SetFieldCommand<AttributeGroupDecl>(node.id, (n) => ({ ...n, name: v || null }), "이름 변경"))}
            />
          </div>
        )}
        {(node?.kind === "compositor" || node?.kind === "elementRef" || node?.kind === "groupRef") && (
          <div className="property-form">
            <p className="property-form__hint">이 노드 종류는 편집 UI가 아직 없습니다 — 트리에서 추가/삭제만 가능합니다.</p>
          </div>
        )}
        {node?.annotation?.documentation && node.annotation.documentation.length > 0 && (
          <div className="property-list__docs">
            <div className="property-list__docs-title">문서화</div>
            {node.annotation.documentation.map((doc, i) => (
              <p key={i}>{doc}</p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
