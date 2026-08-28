import { useState } from "react";
import type { Facets } from "@xsd-visualizer/core";
import { TextField } from "./fields.js";

interface FacetEditorProps {
  facets: Facets;
  onChange: (next: Facets) => void;
}

/** Enumeration/pattern/length/inclusive-bound editor for a simpleType restriction. */
export function FacetEditor({ facets, onChange }: FacetEditorProps) {
  const [newEnumValue, setNewEnumValue] = useState("");
  const enumeration = facets.enumeration ?? [];

  return (
    <div className="facet-editor">
      <div className="facet-editor__section-title">enumeration</div>
      {enumeration.map((value, i) => (
        <div className="facet-editor__enum-row" key={i}>
          <span>{value}</span>
          <button
            type="button"
            className="facet-editor__remove"
            onClick={() => onChange({ ...facets, enumeration: enumeration.filter((_, j) => j !== i) })}
          >
            ✕
          </button>
        </div>
      ))}
      <div className="facet-editor__enum-add">
        <input
          className="field__input"
          placeholder="새 값"
          value={newEnumValue}
          onChange={(e) => setNewEnumValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && newEnumValue.trim()) {
              onChange({ ...facets, enumeration: [...enumeration, newEnumValue.trim()] });
              setNewEnumValue("");
            }
          }}
        />
        <button
          type="button"
          disabled={!newEnumValue.trim()}
          onClick={() => {
            onChange({ ...facets, enumeration: [...enumeration, newEnumValue.trim()] });
            setNewEnumValue("");
          }}
        >
          추가
        </button>
      </div>

      <TextField label="pattern" value={facets.pattern ?? ""} onCommit={(v) => onChange({ ...facets, pattern: v || undefined })} />
      <TextField
        label="minLength"
        value={facets.minLength?.toString() ?? ""}
        onCommit={(v) => onChange({ ...facets, minLength: v === "" ? undefined : Number(v) })}
      />
      <TextField
        label="maxLength"
        value={facets.maxLength?.toString() ?? ""}
        onCommit={(v) => onChange({ ...facets, maxLength: v === "" ? undefined : Number(v) })}
      />
      <TextField
        label="minInclusive"
        value={facets.minInclusive ?? ""}
        onCommit={(v) => onChange({ ...facets, minInclusive: v || undefined })}
      />
      <TextField
        label="maxInclusive"
        value={facets.maxInclusive ?? ""}
        onCommit={(v) => onChange({ ...facets, maxInclusive: v || undefined })}
      />
    </div>
  );
}
