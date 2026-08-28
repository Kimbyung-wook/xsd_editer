import { SetFieldCommand, type ElementDecl, type SchemaModel } from "@xsd-visualizer/core";
import { useSchemaStore } from "../../../state/schemaStore.js";
import { CheckboxField, OccursField, TextField } from "./fields.js";
import { TypeRefSelect } from "./TypeRefSelect.js";

export function ElementForm({ node, model }: { node: ElementDecl; model: SchemaModel }) {
  const dispatch = useSchemaStore((state) => state.dispatch);
  const set = (updater: (n: ElementDecl) => ElementDecl, label: string) =>
    dispatch(new SetFieldCommand<ElementDecl>(node.id, updater, label));

  const inline = typeof node.typeRef === "string";
  const namedTypeRef = typeof node.typeRef === "object" ? node.typeRef : null;

  return (
    <div className="property-form">
      <TextField label="이름" value={node.name ?? ""} onCommit={(v) => set((n) => ({ ...n, name: v || null }), "이름 변경")} />
      <TypeRefSelect
        model={model}
        value={namedTypeRef}
        disabled={inline}
        onChange={(ref) => set((n) => ({ ...n, typeRef: ref }), "타입 변경")}
      />
      <OccursField
        minOccurs={node.minOccurs}
        maxOccurs={node.maxOccurs}
        onChange={({ minOccurs, maxOccurs }) => set((n) => ({ ...n, minOccurs, maxOccurs }), "출현 횟수 변경")}
      />
      <CheckboxField label="nillable" checked={node.nillable} onChange={(v) => set((n) => ({ ...n, nillable: v }), "nillable 변경")} />
      <CheckboxField label="abstract" checked={node.abstract} onChange={(v) => set((n) => ({ ...n, abstract: v }), "abstract 변경")} />
      <TextField label="default" value={node.default ?? ""} onCommit={(v) => set((n) => ({ ...n, default: v || null }), "default 변경")} />
      <TextField label="fixed" value={node.fixed ?? ""} onCommit={(v) => set((n) => ({ ...n, fixed: v || null }), "fixed 변경")} />
    </div>
  );
}
