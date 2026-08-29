import { codegenRegistry } from "./registry.js";
import { cGenerator } from "./generators/c/cGenerator.js";
import { pythonGenerator } from "./generators/python/pythonGenerator.js";

/**
 * Self-registration entry point (docs/PLAN.md codegen/builtins.ts). Adding a new target language
 * is one class under generators/<lang>/ plus one import+register line here — nothing else in the
 * core changes.
 */
codegenRegistry.register(cGenerator);
codegenRegistry.register(pythonGenerator);
