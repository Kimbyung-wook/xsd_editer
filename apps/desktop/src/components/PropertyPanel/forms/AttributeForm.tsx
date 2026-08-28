import { SetFieldCommand, type AttributeDecl, type SchemaModel } from "@xsd-visualizer/core";
import { useSchemaStore } from "../../../state/schemaStore.js";
import { TextField } from "./fields.js";
import { TypeRefSelect } from "./TypeRefSelect.js";

const USE_OPTIONS: AttributeDecl["use"][] = ["optional", "required", "prohibited"];

export function AttributeForm({ node, model }: { node: AttributeDecl; model: SchemaModel }) {
  const dispatch = useSchemaStore((state) => state.dispatch);
  const set = (updater: (n: AttributeDecl) => AttributeDecl, label: string) =>
    dispatch(new SetFieldCommand<AttributeDecl>(node.id, updater, label));

  if (node.ref) {
    return (
      <div className="property-form">
        <div className="field field--readonly">
          <span className="field__label">참조</span>
          <span>{node.ref.qname.localName}</span>
        </div>
      </div>
    );
  }

  const inline = typeof node.typeRef === "string";
  const namedTypeRef = typeof node.typeRef === "object" ? node.typeRef : null;

  return (
    <div className="property-form">
      <TextField label="이름" value={node.name ?? ""} onCommit={(v) => set((n) => ({ ...n, name: v || null }), "이름 변경")} />
      <TypeRefSelect
        model={model}
        value={namedTypeRef}
        kinds={["simpleType"]}
        disabled={inline}
        onChange={(ref) => set((n) => ({ ...n, typeRef: ref }), "타입 변경")}
      />
      <label className="field">
        <span className="field__label">use</span>
        <select
          className="field__input"
          value={node.use}
          onChange={(e) => set((n) => ({ ...n, use: e.target.value as AttributeDecl["use"] }), "use 변경")}
        >
          {USE_OPTIONS.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </label>
      <TextField label="default" value={node.default ?? ""} onCommit={(v) => set((n) => ({ ...n, default: v || null }), "default 변경")} />
      <TextField label="fixed" value={node.fixed ?? ""} onCommit={(v) => set((n) => ({ ...n, fixed: v || null }), "fixed 변경")} />
    </div>
  );
}
