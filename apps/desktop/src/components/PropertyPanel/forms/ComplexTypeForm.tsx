import { SetFieldCommand, type ComplexTypeDecl } from "@xsd-visualizer/core";
import { useSchemaStore } from "../../../state/schemaStore.js";
import { CheckboxField, TextField } from "./fields.js";

export function ComplexTypeForm({ node }: { node: ComplexTypeDecl }) {
  const dispatch = useSchemaStore((state) => state.dispatch);
  const set = (updater: (n: ComplexTypeDecl) => ComplexTypeDecl, label: string) =>
    dispatch(new SetFieldCommand<ComplexTypeDecl>(node.id, updater, label));

  return (
    <div className="property-form">
      <TextField label="이름" value={node.name ?? ""} onCommit={(v) => set((n) => ({ ...n, name: v || null }), "이름 변경")} />
      <CheckboxField label="abstract" checked={node.abstract} onChange={(v) => set((n) => ({ ...n, abstract: v }), "abstract 변경")} />
      <CheckboxField label="mixed" checked={node.mixed} onChange={(v) => set((n) => ({ ...n, mixed: v }), "mixed 변경")} />
      {node.derivation && (
        <div className="field field--readonly">
          <span className="field__label">derivation</span>
          <span>
            {node.derivation.kind} {node.derivation.baseRef.qname.localName}
          </span>
        </div>
      )}
      <p className="property-form__hint">자식 요소 구조는 트리에서 편집합니다.</p>
    </div>
  );
}
