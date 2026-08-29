/** Identifier-casing helpers shared by every generator (docs/PLAN.md naming.ts). */

function splitWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word.length > 0);
}

export function toPascalCase(name: string): string {
  const words = splitWords(name);
  if (words.length === 0) return "Unnamed";
  return words.map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase()).join("");
}

export function toCamelCase(name: string): string {
  const pascal = toPascalCase(name);
  return pascal[0].toLowerCase() + pascal.slice(1);
}

export function toSnakeCase(name: string): string {
  const words = splitWords(name);
  if (words.length === 0) return "unnamed";
  return words.map((word) => word.toLowerCase()).join("_");
}

export function toScreamingSnakeCase(name: string): string {
  return toSnakeCase(name).toUpperCase();
}

const C_KEYWORDS = new Set([
  "auto", "break", "case", "char", "const", "continue", "default", "do", "double", "else", "enum",
  "extern", "float", "for", "goto", "if", "inline", "int", "long", "register", "restrict", "return",
  "short", "signed", "sizeof", "static", "struct", "switch", "typedef", "union", "unsigned", "void",
  "volatile", "while", "bool", "true", "false", "class", "namespace", "template", "new", "delete",
  "public", "private", "protected", "this", "virtual"
]);

const PYTHON_KEYWORDS = new Set([
  "False", "None", "True", "and", "as", "assert", "async", "await", "break", "class", "continue",
  "def", "del", "elif", "else", "except", "finally", "for", "from", "global", "if", "import", "in",
  "is", "lambda", "nonlocal", "not", "or", "pass", "raise", "return", "try", "while", "with", "yield",
  "type", "self"
]);

/** Guarantees a valid, non-reserved identifier by appending "_" when it collides with a keyword. */
export function safeIdentifier(name: string, keywords: Set<string>): string {
  const safe = /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : name.replace(/^[^A-Za-z_]+/, "_").replace(/[^A-Za-z0-9_]/g, "_");
  const nonEmpty = safe.length > 0 ? safe : "_";
  return keywords.has(nonEmpty) ? `${nonEmpty}_` : nonEmpty;
}

export function safeCIdentifier(name: string): string {
  return safeIdentifier(name, C_KEYWORDS);
}

export function safePythonIdentifier(name: string): string {
  return safeIdentifier(name, PYTHON_KEYWORDS);
}
