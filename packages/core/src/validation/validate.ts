import type { SchemaModel } from "../model/schemaModel.js";
import type { Diagnostic } from "./diagnostic.js";
import { checkStructuralRules } from "./rules/structuralRules.js";
import { checkFacetRules } from "./rules/facetRules.js";

/**
 * Full-model validation. Run on load, and after each edit while the schema stays small enough
 * for this to be imperceptibly fast (benchmarked against the 8MB/150k-line target — see
 * docs/PLAN.md); a true incremental validator that only re-checks nodes touched by the last
 * command is the natural next step if that benchmark ever shows otherwise.
 */
export function validateModel(model: SchemaModel): Diagnostic[] {
  return [...checkStructuralRules(model), ...checkFacetRules(model)];
}
