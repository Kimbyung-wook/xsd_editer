import type { ICodeGenerator } from "./types.js";

/**
 * Registry of available code generators (docs/PLAN.md codegen/registry.ts). A new language only
 * needs a class implementing ICodeGenerator plus one `register()` call in builtins.ts.
 */
export class CodegenRegistry {
  private readonly generators = new Map<string, ICodeGenerator>();

  register(generator: ICodeGenerator): void {
    this.generators.set(generator.id, generator);
  }

  get(id: string): ICodeGenerator | undefined {
    return this.generators.get(id);
  }

  list(): ICodeGenerator[] {
    return [...this.generators.values()];
  }
}

export const codegenRegistry = new CodegenRegistry();
