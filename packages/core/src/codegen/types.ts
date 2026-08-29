import type { NodeId } from "../model/nodeId.js";
import type { SchemaModel } from "../model/schemaModel.js";

export interface GeneratedFile {
  /** Relative filename (e.g. "person.h"); the caller decides the output directory. */
  path: string;
  content: string;
}

export interface OptionField {
  key: string;
  label: string;
  type: "boolean" | "select";
  default: boolean | string;
  /** Required when type is "select". */
  choices?: { value: string; label: string }[];
}

export type OptionsSchema = OptionField[];

export interface CodegenWarning {
  nodeId?: NodeId;
  message: string;
}

/**
 * Plugin contract for a code generator (docs/PLAN.md codegen/ section). Adding a new target
 * language only requires one class here plus one registration line in builtins.ts — the core
 * (registry, IR, UI) never needs to change.
 */
export interface ICodeGenerator<TOptions extends Record<string, unknown> = Record<string, unknown>> {
  id: string;
  displayName: string;
  getOptionsSchema(): OptionsSchema;
  /** Non-fatal warnings about schema constructs this generator approximates or skips. */
  validateModelSupport?(model: SchemaModel): CodegenWarning[];
  generate(model: SchemaModel, options: TOptions): GeneratedFile[];
}

export function defaultOptionsFrom(schema: OptionsSchema): Record<string, unknown> {
  const options: Record<string, unknown> = {};
  for (const field of schema) {
    options[field.key] = field.default;
  }
  return options;
}
