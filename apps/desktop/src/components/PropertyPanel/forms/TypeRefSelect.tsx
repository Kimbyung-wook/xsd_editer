import type { QNameRef, SchemaModel } from "@xsd-visualizer/core";
import { XSD_BUILT_IN_TYPES } from "./fields.js";

const XSD_NAMESPACE = "http://www.w3.org/2001/XMLSchema";
const BOTH_KINDS: Array<"complexType" | "simpleType"> = ["complexType", "simpleType"];

interface TypeRefSelectProps {
  model: SchemaModel;
  /** null when the element/attribute currently has an inline anonymous type (not editable here). */
  value: QNameRef | null;
  disabled?: boolean;
  onChange: (ref: QNameRef) => void;
  /** Restrict the "스키마 내 타입" list, e.g. to simpleType only for a simpleType's restriction base. */
  kinds?: Array<"complexType" | "simpleType">;
}

function qnameKey(ref: { namespaceURI: string | null; localName: string }): string {
  return `${ref.namespaceURI ?? ""}#${ref.localName}`;
}

/**
 * Searchable-enough dropdown of built-in XSD types plus every named complexType/simpleType in
 * the loaded schema set. Deliberately not memoized: `model` mutates in place (see
 * schemaStore.ts), so a `[model, ...]`-keyed memo here would silently go stale after an edit
 * elsewhere renames or adds a type — recomputing this list on every render is cheap (a single
 * pass over the model's nodes; ~30ms even at the 8MB/150k-line benchmark scale) and correct.
 */
export function TypeRefSelect({ model, value, disabled, onChange, kinds = BOTH_KINDS }: TypeRefSelectProps) {
  const namedTypeOptions: { key: string; label: string; namespaceURI: string | null; localName: string }[] = [];
  for (const node of model.allNodes()) {
    if ((node.kind === "complexType" || node.kind === "simpleType") && kinds.includes(node.kind) && node.name) {
      namedTypeOptions.push({
        key: qnameKey({ namespaceURI: node.namespaceURI, localName: node.name }),
        label: node.name,
        namespaceURI: node.namespaceURI,
        localName: node.name
      });
    }
  }
  namedTypeOptions.sort((a, b) => a.label.localeCompare(b.label));

  const currentKey = value ? qnameKey(value.qname) : "";

  return (
    <label className="field">
      <span className="field__label">타입</span>
      <select
        className="field__input"
        disabled={disabled}
        value={currentKey}
        onChange={(e) => {
          const key = e.target.value;
          const builtIn = XSD_BUILT_IN_TYPES.find((t) => qnameKey({ namespaceURI: XSD_NAMESPACE, localName: t }) === key);
          if (builtIn) {
            onChange({ qname: { namespaceURI: XSD_NAMESPACE, localName: builtIn }, resolvedTargetId: null });
            return;
          }
          const named = namedTypeOptions.find((o) => o.key === key);
          if (named) {
            onChange({ qname: { namespaceURI: named.namespaceURI, localName: named.localName }, resolvedTargetId: null });
          }
        }}
      >
        {disabled && <option value="">(inline type)</option>}
        {!disabled && currentKey === "" && <option value="">(선택)</option>}
        <optgroup label="XSD 내장 타입">
          {XSD_BUILT_IN_TYPES.map((t) => (
            <option key={t} value={qnameKey({ namespaceURI: XSD_NAMESPACE, localName: t })}>
              xs:{t}
            </option>
          ))}
        </optgroup>
        <optgroup label="스키마 내 타입">
          {namedTypeOptions.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </optgroup>
      </select>
    </label>
  );
}
