import { SetFieldCommand, type AnyNode } from "@xsd-visualizer/core";
import { useSchemaStore } from "../../../state/schemaStore.js";
import { OccursField, TextField } from "./fields.js";

const PROCESS_CONTENTS_OPTIONS: AnyNode["processContents"][] = ["strict", "lax", "skip"];

export function AnyForm({ node }: { node: AnyNode }) {
  const dispatch = useSchemaStore((state) => state.dispatch);
  const set = (updater: (n: AnyNode) => AnyNode, label: string) => dispatch(new SetFieldCommand<AnyNode>(node.id, updater, label));

  return (
    <div className="property-form">
      <p className="property-form__hint">xs:any 와일드카드 — 임의의 요소를 허용하며 이 스키마에서 구조적으로 모델링되지 않습니다.</p>
      <TextField
        label="namespace"
        value={node.namespace ?? ""}
        placeholder="##any"
        onCommit={(v) => set((n) => ({ ...n, namespace: v || null }), "namespace 변경")}
      />
      <label className="field">
        <span className="field__label">processContents</span>
        <select
          className="field__input"
          value={node.processContents}
          onChange={(e) => set((n) => ({ ...n, processContents: e.target.value as AnyNode["processContents"] }), "processContents 변경")}
        >
          {PROCESS_CONTENTS_OPTIONS.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <OccursField
        minOccurs={node.minOccurs}
        maxOccurs={node.maxOccurs}
        onChange={({ minOccurs, maxOccurs }) => set((n) => ({ ...n, minOccurs, maxOccurs }), "출현 횟수 변경")}
      />
    </div>
  );
}
