import { useState } from "react";
import { SetFieldCommand, type Facets, type QNameRef, type SchemaModel, type SimpleTypeDecl, type SimpleTypeVariant } from "@xsd-visualizer/core";
import { useSchemaStore } from "../../../state/schemaStore.js";
import { TextField } from "./fields.js";
import { TypeRefSelect } from "./TypeRefSelect.js";
import { FacetEditor } from "./FacetEditor.js";

const VARIANTS: SimpleTypeVariant[] = ["restriction", "list", "union"];

function MemberTypesEditor({ model, members, onChange }: { model: SchemaModel; members: QNameRef[]; onChange: (members: QNameRef[]) => void }) {
  const [pendingRef, setPendingRef] = useState<QNameRef | null>(null);

  return (
    <div className="facet-editor">
      <div className="facet-editor__section-title">memberTypes</div>
      {members.map((ref, i) => (
        <div className="facet-editor__enum-row" key={i}>
          <span>{ref.qname.localName}</span>
          <button type="button" className="facet-editor__remove" onClick={() => onChange(members.filter((_, j) => j !== i))}>
            ✕
          </button>
        </div>
      ))}
      <div className="facet-editor__enum-add">
        <TypeRefSelect model={model} value={pendingRef} kinds={["simpleType"]} onChange={setPendingRef} />
        <button
          type="button"
          disabled={!pendingRef}
          onClick={() => {
            if (!pendingRef) return;
            onChange([...members, pendingRef]);
            setPendingRef(null);
          }}
        >
          추가
        </button>
      </div>
    </div>
  );
}

export function SimpleTypeForm({ node, model }: { node: SimpleTypeDecl; model: SchemaModel }) {
  const dispatch = useSchemaStore((state) => state.dispatch);
  const set = (updater: (n: SimpleTypeDecl) => SimpleTypeDecl, label: string) =>
    dispatch(new SetFieldCommand<SimpleTypeDecl>(node.id, updater, label));

  return (
    <div className="property-form">
      <TextField label="이름" value={node.name ?? ""} onCommit={(v) => set((n) => ({ ...n, name: v || null }), "이름 변경")} />
      <label className="field">
        <span className="field__label">종류</span>
        <select
          className="field__input"
          value={node.variant}
          onChange={(e) => set((n) => ({ ...n, variant: e.target.value as SimpleTypeVariant }), "종류 변경")}
        >
          {VARIANTS.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </label>

      {node.variant === "restriction" && (
        <>
          <TypeRefSelect
            model={model}
            value={node.baseRef}
            kinds={["simpleType"]}
            onChange={(ref) => set((n) => ({ ...n, baseRef: ref }), "base 변경")}
          />
          <FacetEditor facets={node.facets} onChange={(facets: Facets) => set((n) => ({ ...n, facets }), "facet 변경")} />
        </>
      )}

      {node.variant === "list" && (
        <TypeRefSelect
          model={model}
          value={node.itemTypeRef}
          kinds={["simpleType"]}
          onChange={(ref) => set((n) => ({ ...n, itemTypeRef: ref }), "itemType 변경")}
        />
      )}

      {node.variant === "union" && (
        <MemberTypesEditor
          model={model}
          members={node.memberTypeRefs}
          onChange={(members) => set((n) => ({ ...n, memberTypeRefs: members }), "memberTypes 변경")}
        />
      )}

      {node.variant !== "restriction" && Object.keys(node.facets).length > 0 && (
        <p className="property-form__hint">참고: 이전 restriction의 facet 값이 남아있지만 {node.variant}에는 적용되지 않습니다.</p>
      )}
    </div>
  );
}
