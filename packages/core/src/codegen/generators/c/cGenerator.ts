import { buildCodegenIr, type IrEnum, type IrFieldType, type IrStruct } from "../../ir.js";
import { safeCIdentifier, toSnakeCase, toScreamingSnakeCase } from "../../naming.js";
import type { IrPrimitiveKind } from "../../typeMapping.js";
import type { GeneratedFile, ICodeGenerator, OptionsSchema } from "../../types.js";

interface CGeneratorOptions extends Record<string, unknown> {
  language: string;
  includeSerializationStubs: boolean;
}

const C_STRING_PRIMITIVES = new Set<IrPrimitiveKind>([
  "string", "anyURI", "date", "dateTime", "time", "duration", "base64Binary", "hexBinary"
]);

function isCStringPrimitive(primitive: IrPrimitiveKind): boolean {
  return C_STRING_PRIMITIVES.has(primitive);
}

function cPrimitiveType(primitive: IrPrimitiveKind): string {
  switch (primitive) {
    case "boolean": return "bool";
    case "byte": return "int8_t";
    case "unsignedByte": return "uint8_t";
    case "short": return "int16_t";
    case "unsignedShort": return "uint16_t";
    case "int": return "int32_t";
    case "unsignedInt": return "uint32_t";
    case "long": return "int64_t";
    case "unsignedLong": return "uint64_t";
    case "decimal": return "double";
    case "float": return "float";
    case "double": return "double";
    default: return "char*";
  }
}

function baseCType(fieldType: IrFieldType, asPointerForStruct: boolean): string {
  if (fieldType.kind === "primitive") return cPrimitiveType(fieldType.primitive);
  if (fieldType.kind === "enum") return safeCIdentifier(fieldType.enumName);
  return `${safeCIdentifier(fieldType.structName)}${asPointerForStruct ? "*" : ""}`;
}

function uniqueCFieldName(name: string, used: Set<string>): string {
  const base = safeCIdentifier(toSnakeCase(name));
  let candidate = base;
  let n = 2;
  while (used.has(candidate)) {
    candidate = `${base}_${n}`;
    n += 1;
  }
  used.add(candidate);
  return candidate;
}

function assignFieldNames(struct: IrStruct): Map<string, string> {
  const used = new Set<string>(["base"]);
  const map = new Map<string, string>();
  for (const field of struct.fields) {
    map.set(field.name, uniqueCFieldName(field.name, used));
  }
  return map;
}

function cEnumMemberName(enumName: string, literal: string, used: Set<string>): string {
  let base = `${toScreamingSnakeCase(enumName)}_${toScreamingSnakeCase(literal) || "VALUE"}`;
  if (/^[0-9]/.test(base)) base = `_${base}`;
  base = safeCIdentifier(base);
  let candidate = base;
  let n = 2;
  while (used.has(candidate)) {
    candidate = `${base}_${n}`;
    n += 1;
  }
  used.add(candidate);
  return candidate;
}

/**
 * Breaks required-struct-field cycles (direct or via extension) with pointers so C struct layouts
 * stay finite-size, and returns a dependency-first emission order for the rest. Optional and
 * repeated struct fields are already pointers/arrays and never need to be considered here.
 */
function computeEmbedPlan(structs: IrStruct[]): { order: string[]; forcePointer: Set<string> } {
  const byName = new Map(structs.map((s) => [s.name, s]));
  const state = new Map<string, 0 | 1 | 2>();
  const order: string[] = [];
  const forcePointer = new Set<string>();

  function candidateEdges(struct: IrStruct): { key: string; target: string }[] {
    const edges: { key: string; target: string }[] = [];
    if (struct.baseStructName && byName.has(struct.baseStructName)) {
      edges.push({ key: `${struct.name}.__base`, target: struct.baseStructName });
    }
    for (const field of struct.fields) {
      if (field.fieldType.kind === "struct" && !field.repeated && !field.optional && byName.has(field.fieldType.structName)) {
        edges.push({ key: `${struct.name}.${field.name}`, target: field.fieldType.structName });
      }
    }
    return edges;
  }

  function visit(name: string): void {
    state.set(name, 1);
    const struct = byName.get(name);
    if (struct) {
      for (const edge of candidateEdges(struct)) {
        const targetState = state.get(edge.target) ?? 0;
        if (targetState === 1) {
          forcePointer.add(edge.key);
          continue;
        }
        if (targetState === 0) visit(edge.target);
      }
    }
    state.set(name, 2);
    order.push(name);
  }

  for (const struct of structs) {
    if ((state.get(struct.name) ?? 0) === 0) visit(struct.name);
  }
  return { order, forcePointer };
}

function renderEnum(en: IrEnum): string[] {
  const lines: string[] = [];
  if (en.docs) lines.push(`/** ${en.docs} */`);
  lines.push("typedef enum {");
  const used = new Set<string>();
  const members = en.members.length > 0 ? en.members : [{ literal: "unspecified" }];
  lines.push(members.map((m) => `  ${cEnumMemberName(en.name, m.literal, used)}`).join(",\n"));
  lines.push(`} ${safeCIdentifier(en.name)};`, "");
  return lines;
}

function renderStruct(
  struct: IrStruct,
  forcePointer: Set<string>,
  structByName: Map<string, IrStruct>,
  fieldNames: Map<string, string>
): string[] {
  const lines: string[] = [];
  if (struct.docs) lines.push(`/** ${struct.docs} */`);
  lines.push(`struct ${safeCIdentifier(struct.name)} {`);

  if (struct.baseStructName && structByName.has(struct.baseStructName)) {
    const baseIsPointer = forcePointer.has(`${struct.name}.__base`);
    lines.push(`  ${safeCIdentifier(struct.baseStructName)}${baseIsPointer ? "*" : ""} base; /* extends ${struct.baseStructName} */`);
  }

  for (const field of struct.fields) {
    const fname = fieldNames.get(field.name) as string;
    if (field.docs) lines.push(`  /** ${field.docs} */`);
    const attrComment = field.isAttribute ? " /* attribute */" : "";
    if (field.repeated) {
      lines.push(`  ${baseCType(field.fieldType, false)}* ${fname};${attrComment}`);
      lines.push(`  size_t ${fname}_count;`);
    } else if (field.optional) {
      if (field.fieldType.kind === "struct") {
        lines.push(`  ${baseCType(field.fieldType, true)} ${fname};${attrComment}`);
      } else {
        lines.push(`  bool has_${fname};`);
        lines.push(`  ${baseCType(field.fieldType, false)} ${fname};${attrComment}`);
      }
    } else if (field.fieldType.kind === "struct") {
      const isPointer = forcePointer.has(`${struct.name}.${field.name}`);
      lines.push(`  ${baseCType(field.fieldType, isPointer)} ${fname};${attrComment}`);
    } else {
      lines.push(`  ${baseCType(field.fieldType, false)} ${fname};${attrComment}`);
    }
  }

  if (struct.fields.length === 0 && !struct.baseStructName) {
    lines.push("  char _reserved; /* empty content model */");
  }
  lines.push("};", "");
  return lines;
}

function renderInit(struct: IrStruct): string[] {
  const name = safeCIdentifier(struct.name);
  return [
    `void ${name}_init(${name}* self) {`,
    "  if (self == NULL) return;",
    "  memset(self, 0, sizeof(*self));",
    "}",
    ""
  ];
}

function renderFree(
  struct: IrStruct,
  forcePointer: Set<string>,
  structByName: Map<string, IrStruct>,
  fieldNames: Map<string, string>
): string[] {
  const name = safeCIdentifier(struct.name);
  const lines: string[] = [`void ${name}_free(${name}* self) {`, "  if (self == NULL) return;"];

  if (struct.baseStructName && structByName.has(struct.baseStructName)) {
    const baseType = safeCIdentifier(struct.baseStructName);
    if (forcePointer.has(`${struct.name}.__base`)) {
      lines.push(`  if (self->base != NULL) { ${baseType}_free(self->base); free(self->base); self->base = NULL; }`);
    } else {
      lines.push(`  ${baseType}_free(&self->base);`);
    }
  }

  for (const field of struct.fields) {
    const fname = fieldNames.get(field.name) as string;
    if (field.repeated) {
      lines.push(`  if (self->${fname} != NULL) {`);
      if (field.fieldType.kind === "struct" && structByName.has(field.fieldType.structName)) {
        const elemType = safeCIdentifier(field.fieldType.structName);
        lines.push(`    for (size_t i = 0; i < self->${fname}_count; i++) { ${elemType}_free(&self->${fname}[i]); }`);
      } else if (field.fieldType.kind === "primitive" && isCStringPrimitive(field.fieldType.primitive)) {
        lines.push(`    for (size_t i = 0; i < self->${fname}_count; i++) { free(self->${fname}[i]); }`);
      }
      lines.push(`    free(self->${fname});`);
      lines.push(`    self->${fname} = NULL;`);
      lines.push("  }");
      lines.push(`  self->${fname}_count = 0;`);
    } else if (field.fieldType.kind === "struct" && structByName.has(field.fieldType.structName)) {
      const structType = safeCIdentifier(field.fieldType.structName);
      const isPointer = field.optional || forcePointer.has(`${struct.name}.${field.name}`);
      if (isPointer) {
        lines.push(`  if (self->${fname} != NULL) { ${structType}_free(self->${fname}); free(self->${fname}); self->${fname} = NULL; }`);
      } else {
        lines.push(`  ${structType}_free(&self->${fname});`);
      }
    } else if (field.fieldType.kind === "primitive" && isCStringPrimitive(field.fieldType.primitive)) {
      lines.push(`  free(self->${fname});`);
      lines.push(`  self->${fname} = NULL;`);
      if (field.optional) lines.push(`  self->has_${fname} = false;`);
    } else if (field.optional) {
      lines.push(`  self->has_${fname} = false;`);
    }
  }

  lines.push("}", "");
  return lines;
}

function getOptionsSchema(): OptionsSchema {
  return [
    {
      key: "language",
      label: "언어",
      type: "select",
      default: "c",
      choices: [
        { value: "c", label: "C (C99)" },
        { value: "cpp", label: "C++" }
      ]
    },
    { key: "includeSerializationStubs", label: "직렬화 함수 스텁 포함", type: "boolean", default: false }
  ];
}

/**
 * complexType -> struct, enumeration facet -> enum (docs/PLAN.md codegen/ C/C++ 생성기).
 * Struct emission order and pointer-vs-value-embed are resolved by computeEmbedPlan so recursive
 * or mutually recursive types still produce a compilable, finite-size layout. Serialization is a
 * stub-only opt-in (`includeSerializationStubs`); actual XML I/O is left to the caller for now
 * (see docs/PLAN.md 주요 리스크).
 */
export const cGenerator: ICodeGenerator<CGeneratorOptions> = {
  id: "c",
  displayName: "C / C++",
  getOptionsSchema,
  validateModelSupport(model) {
    return buildCodegenIr(model).warnings;
  },
  generate(model, options) {
    const ir = buildCodegenIr(model);
    const language = options.language === "cpp" ? "cpp" : "c";
    const headerExt = language === "cpp" ? "hpp" : "h";
    const sourceExt = language === "cpp" ? "cpp" : "c";
    const baseName = "schema";
    const guard = `${baseName.toUpperCase()}_${headerExt.toUpperCase()}`;

    const plan = computeEmbedPlan(ir.structs);
    const structByName = new Map(ir.structs.map((s) => [s.name, s]));
    const fieldNamesByStruct = new Map(ir.structs.map((s) => [s.name, assignFieldNames(s)]));

    const header: string[] = [`#ifndef ${guard}`, `#define ${guard}`, ""];
    if (language === "c") header.push("#ifndef __cplusplus", "#include <stdbool.h>", "#endif");
    header.push("#include <stdint.h>", "#include <stddef.h>", "");
    if (language === "cpp") header.push('extern "C" {', "");

    for (const en of ir.enums) header.push(...renderEnum(en));

    if (ir.structs.length > 0) {
      header.push("/* forward declarations */");
      for (const s of ir.structs) header.push(`typedef struct ${safeCIdentifier(s.name)} ${safeCIdentifier(s.name)};`);
      header.push("");
    }

    for (const name of plan.order) {
      const s = structByName.get(name);
      if (!s) continue;
      const fieldNames = fieldNamesByStruct.get(name) as Map<string, string>;
      header.push(...renderStruct(s, plan.forcePointer, structByName, fieldNames));
      const typeName = safeCIdentifier(s.name);
      header.push(`void ${typeName}_init(${typeName}* self);`);
      header.push(`void ${typeName}_free(${typeName}* self);`);
      if (options.includeSerializationStubs) {
        header.push("/* TODO: implement serialization */");
        header.push(`char* ${typeName}_toXmlString(const ${typeName}* self);`);
        header.push(`bool ${typeName}_fromXmlString(const char* xml, ${typeName}* out);`);
      }
      header.push("");
    }

    if (language === "cpp") header.push("}", "");
    header.push(`#endif /* ${guard} */`, "");

    const source: string[] = [`#include "${baseName}.${headerExt}"`, "#include <string.h>", "#include <stdlib.h>", ""];
    for (const name of plan.order) {
      const s = structByName.get(name);
      if (!s) continue;
      const fieldNames = fieldNamesByStruct.get(name) as Map<string, string>;
      source.push(...renderInit(s));
      source.push(...renderFree(s, plan.forcePointer, structByName, fieldNames));
    }

    const files: GeneratedFile[] = [
      { path: `${baseName}.${headerExt}`, content: header.join("\n") },
      { path: `${baseName}.${sourceExt}`, content: source.join("\n") }
    ];
    return files;
  }
};
