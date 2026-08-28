import type { SchemaModel } from "../../model/schemaModel.js";
import type { Diagnostic } from "../diagnostic.js";

function isValidRegex(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

/** Facet-level sanity checks on simpleType restrictions (enumeration/pattern/length/inclusive bounds). */
export function checkFacetRules(model: SchemaModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const node of model.allNodes()) {
    if (node.kind !== "simpleType") continue;
    const { facets } = node;

    if (facets.enumeration) {
      const seen = new Set<string>();
      for (const value of facets.enumeration) {
        if (seen.has(value)) {
          diagnostics.push({ severity: "warning", code: "duplicate-enumeration", nodeId: node.id, message: `enumeration 값이 중복됩니다: ${value}` });
        }
        seen.add(value);
      }
    }

    if (facets.pattern !== undefined && !isValidRegex(facets.pattern)) {
      diagnostics.push({ severity: "error", code: "invalid-pattern", nodeId: node.id, message: `pattern이 유효한 정규식이 아닙니다: ${facets.pattern}` });
    }

    if (facets.minLength !== undefined && facets.maxLength !== undefined && facets.minLength > facets.maxLength) {
      diagnostics.push({ severity: "error", code: "invalid-length-range", nodeId: node.id, message: "minLength가 maxLength보다 큽니다." });
    }

    if (facets.minInclusive !== undefined && facets.maxInclusive !== undefined) {
      const min = Number(facets.minInclusive);
      const max = Number(facets.maxInclusive);
      if (!Number.isNaN(min) && !Number.isNaN(max) && min > max) {
        diagnostics.push({ severity: "error", code: "invalid-inclusive-range", nodeId: node.id, message: "minInclusive가 maxInclusive보다 큽니다." });
      }
    }
  }

  return diagnostics;
}
