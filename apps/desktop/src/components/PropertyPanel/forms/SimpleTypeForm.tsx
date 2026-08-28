import { SetFieldCommand, type Facets, type SchemaModel, type SimpleTypeDecl } from "@xsd-visualizer/core";
import { useSchemaStore } from "../../../state/schemaStore.js";
import { TextField } from "./fields.js";
import { TypeRefSelect } from "./TypeRefSelect.js";
import { FacetEditor } from "./FacetEditor.js";

export function SimpleTypeForm({ node, model }: { node: SimpleTypeDecl; model: SchemaModel }) {
  const dispatch = useSchemaStore((state) => state.dispatch);
  const set = (updater: (n: SimpleTypeDecl) => SimpleTypeDecl, label: string) =>
    dispatch(new SetFieldCommand<SimpleTypeDecl>(node.id, updater, label));

  return (
    <div className="property-form">
      <TextField label="이름" value={node.name ?? ""} onCommit={(v) => set((n) => ({ ...n, name: v || null }), "이름 변경")} />
      <TypeRefSelect
        model={model}
        value={node.baseRef}
        kinds={["simpleType"]}
        onChange={(ref) => set((n) => ({ ...n, baseRef: ref }), "base 변경")}
      />
      <FacetEditor facets={node.facets} onChange={(facets: Facets) => set((n) => ({ ...n, facets }), "facet 변경")} />
    </div>
  );
}
