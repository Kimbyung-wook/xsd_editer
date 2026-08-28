import { useEffect, useState } from "react";

interface TextFieldProps {
  label: string;
  value: string;
  onCommit: (value: string) => void;
  placeholder?: string;
}

/** Local-state-buffered text input; commits one command on blur/Enter, not per keystroke. */
export function TextField({ label, value, onCommit, placeholder }: TextFieldProps) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <input
        className="field__input"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== value) onCommit(draft);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setDraft(value);
        }}
      />
    </label>
  );
}

interface CheckboxFieldProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function CheckboxField({ label, checked, onChange }: CheckboxFieldProps) {
  return (
    <label className="field field--checkbox">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="field__label">{label}</span>
    </label>
  );
}

interface OccursFieldProps {
  minOccurs: number;
  maxOccurs: number | "unbounded";
  onChange: (next: { minOccurs: number; maxOccurs: number | "unbounded" }) => void;
}

export function OccursField({ minOccurs, maxOccurs, onChange }: OccursFieldProps) {
  const unbounded = maxOccurs === "unbounded";
  return (
    <div className="field field--occurs">
      <span className="field__label">출현 횟수</span>
      <div className="field__occurs-row">
        <input
          type="number"
          min={0}
          className="field__input field__input--number"
          value={minOccurs}
          onChange={(e) => onChange({ minOccurs: Math.max(0, Number(e.target.value) || 0), maxOccurs })}
        />
        <span>..</span>
        <input
          type="number"
          min={0}
          disabled={unbounded}
          className="field__input field__input--number"
          value={unbounded ? "" : maxOccurs}
          onChange={(e) => onChange({ minOccurs, maxOccurs: Math.max(0, Number(e.target.value) || 0) })}
        />
        <label className="field__unbounded">
          <input
            type="checkbox"
            checked={unbounded}
            onChange={(e) => onChange({ minOccurs, maxOccurs: e.target.checked ? "unbounded" : 1 })}
          />
          unbounded
        </label>
      </div>
    </div>
  );
}

export const XSD_BUILT_IN_TYPES = [
  "string",
  "boolean",
  "decimal",
  "int",
  "integer",
  "long",
  "double",
  "float",
  "date",
  "dateTime",
  "time",
  "anyURI",
  "ID",
  "IDREF"
];
