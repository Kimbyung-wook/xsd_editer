import { buildCodegenIr, type IrEnum, type IrFieldType, type IrStruct } from "../../ir.js";
import { safePythonIdentifier, toSnakeCase, toScreamingSnakeCase } from "../../naming.js";
import type { IrPrimitiveKind } from "../../typeMapping.js";
import type { GeneratedFile, ICodeGenerator, OptionsSchema } from "../../types.js";

interface PythonGeneratorOptions extends Record<string, unknown> {
  style: string;
}

function pyPrimitiveType(primitive: IrPrimitiveKind): string {
  switch (primitive) {
    case "boolean": return "bool";
    case "byte":
    case "unsignedByte":
    case "short":
    case "unsignedShort":
    case "int":
    case "unsignedInt":
    case "long":
    case "unsignedLong":
      return "int";
    case "decimal": return "decimal.Decimal";
    case "float":
    case "double":
      return "float";
    case "date": return "datetime.date";
    case "dateTime": return "datetime.datetime";
    case "time": return "datetime.time";
    default: return "str";
  }
}

function pyFieldType(fieldType: IrFieldType): string {
  if (fieldType.kind === "primitive") return pyPrimitiveType(fieldType.primitive);
  if (fieldType.kind === "enum") return safePythonIdentifier(fieldType.enumName);
  return safePythonIdentifier(fieldType.structName);
}

function pyStringLiteral(value: string): string {
  return JSON.stringify(value);
}

function uniquePyName(name: string, used: Set<string>): string {
  const base = safePythonIdentifier(toSnakeCase(name)) || "value";
  let candidate = base;
  let n = 2;
  while (used.has(candidate)) {
    candidate = `${base}_${n}`;
    n += 1;
  }
  used.add(candidate);
  return candidate;
}

function pyEnumMemberName(literal: string, used: Set<string>): string {
  let base = toScreamingSnakeCase(literal) || "VALUE";
  if (/^[0-9]/.test(base)) base = `_${base}`;
  base = safePythonIdentifier(base);
  let candidate = base;
  let n = 2;
  while (used.has(candidate)) {
    candidate = `${base}_${n}`;
    n += 1;
  }
  used.add(candidate);
  return candidate;
}

function renderPyEnum(en: IrEnum): string[] {
  const lines: string[] = [`class ${safePythonIdentifier(en.name)}(str, Enum):`];
  if (en.docs) lines.push(`    """${en.docs.replace(/"""/g, '\\"\\"\\"')}"""`);
  const used = new Set<string>();
  const members = en.members.length > 0 ? en.members : [{ literal: "unspecified" }];
  for (const member of members) {
    lines.push(`    ${pyEnumMemberName(member.literal, used)} = ${pyStringLiteral(member.literal)}`);
  }
  lines.push("", "");
  return lines;
}

function renderPyField(field: IrStruct["fields"][number], used: Set<string>, style: "dataclass" | "pydantic"): string {
  const fname = uniquePyName(field.name, used);
  const pyType = pyFieldType(field.fieldType);
  let typeHint: string;
  let defaultExpr: string;
  if (field.repeated) {
    typeHint = `List[${pyType}]`;
    defaultExpr = style === "pydantic" ? "Field(default_factory=list)" : "field(default_factory=list)";
  } else {
    typeHint = `Optional[${pyType}]`;
    defaultExpr = "None";
  }
  let line = `    ${fname}: ${typeHint} = ${defaultExpr}`;
  const notes = [field.docs, !field.repeated && !field.optional ? "required" : null].filter((n): n is string => !!n);
  if (notes.length > 0) line += `  # ${notes.join(" - ")}`;
  return line;
}

function renderPyStruct(struct: IrStruct, style: "dataclass" | "pydantic"): string[] {
  const lines: string[] = [];
  const className = safePythonIdentifier(struct.name);
  const baseClause = struct.baseStructName
    ? safePythonIdentifier(struct.baseStructName)
    : style === "pydantic"
      ? "BaseModel"
      : null;

  if (style === "dataclass") lines.push("@dataclass");
  lines.push(`class ${className}${baseClause ? `(${baseClause})` : ""}:`);

  const body: string[] = [];
  if (struct.docs) body.push(`    """${struct.docs.replace(/"""/g, '\\"\\"\\"')}"""`);
  const used = new Set<string>();
  for (const field of struct.fields) body.push(renderPyField(field, used, style));
  if (body.length === 0) body.push("    pass");

  lines.push(...body, "", "");
  return lines;
}

/** Orders structs so a base class is always defined before any subclass (required for runtime inheritance). */
function orderStructsForPython(structs: IrStruct[]): IrStruct[] {
  const byName = new Map(structs.map((s) => [s.name, s]));
  const order: IrStruct[] = [];
  const state = new Map<string, 0 | 1 | 2>();

  function visit(struct: IrStruct): void {
    const st = state.get(struct.name) ?? 0;
    if (st !== 0) return;
    state.set(struct.name, 1);
    if (struct.baseStructName) {
      const base = byName.get(struct.baseStructName);
      if (base) visit(base);
    }
    state.set(struct.name, 2);
    order.push(struct);
  }

  for (const struct of structs) visit(struct);
  return order;
}

function getOptionsSchema(): OptionsSchema {
  return [
    {
      key: "style",
      label: "스타일",
      type: "select",
      default: "dataclass",
      choices: [
        { value: "dataclass", label: "dataclasses.dataclass" },
        { value: "pydantic", label: "Pydantic BaseModel" }
      ]
    }
  ];
}

/**
 * complexType -> @dataclass (기본) 또는 Pydantic BaseModel, enumeration facet -> `class X(str, Enum)`
 * (docs/PLAN.md codegen/ Python 생성기). Every field is emitted as Optional-with-default (lists
 * default to an empty list) regardless of XSD minOccurs, so multi-level dataclass inheritance never
 * hits Python's "non-default argument follows default argument" ordering error; the original
 * required/optional distinction is preserved only as a "# required" trailing comment.
 */
export const pythonGenerator: ICodeGenerator<PythonGeneratorOptions> = {
  id: "python",
  displayName: "Python",
  getOptionsSchema,
  validateModelSupport(model) {
    return buildCodegenIr(model).warnings;
  },
  generate(model, options) {
    const ir = buildCodegenIr(model);
    const style = options.style === "pydantic" ? "pydantic" : "dataclass";

    const lines: string[] = [
      '"""Auto-generated from XSD schema. Do not edit by hand."""',
      "from __future__ import annotations",
      "",
      "import datetime",
      "import decimal",
      "from enum import Enum",
      "from typing import List, Optional",
      ""
    ];
    lines.push(style === "pydantic" ? "from pydantic import BaseModel, Field" : "from dataclasses import dataclass, field");
    lines.push("", "");

    for (const en of ir.enums) lines.push(...renderPyEnum(en));
    for (const struct of orderStructsForPython(ir.structs)) lines.push(...renderPyStruct(struct, style));

    const files: GeneratedFile[] = [{ path: "schema.py", content: lines.join("\n") }];
    return files;
  }
};
