/** XSD built-in type -> language-independent primitive kind, shared by every generator. */
export type IrPrimitiveKind =
  | "string"
  | "boolean"
  | "byte"
  | "unsignedByte"
  | "short"
  | "unsignedShort"
  | "int"
  | "unsignedInt"
  | "long"
  | "unsignedLong"
  | "decimal"
  | "float"
  | "double"
  | "date"
  | "dateTime"
  | "time"
  | "duration"
  | "base64Binary"
  | "hexBinary"
  | "anyURI";

const BUILTIN_MAP: Record<string, IrPrimitiveKind> = {
  string: "string",
  normalizedString: "string",
  token: "string",
  language: "string",
  Name: "string",
  NCName: "string",
  NMTOKEN: "string",
  ID: "string",
  IDREF: "string",
  QName: "string",
  anyURI: "anyURI",
  boolean: "boolean",
  byte: "byte",
  unsignedByte: "unsignedByte",
  short: "short",
  unsignedShort: "unsignedShort",
  int: "int",
  unsignedInt: "unsignedInt",
  integer: "int",
  nonNegativeInteger: "unsignedInt",
  positiveInteger: "unsignedInt",
  nonPositiveInteger: "int",
  negativeInteger: "int",
  long: "long",
  unsignedLong: "unsignedLong",
  decimal: "decimal",
  float: "float",
  double: "double",
  date: "date",
  dateTime: "dateTime",
  time: "time",
  duration: "duration",
  base64Binary: "base64Binary",
  hexBinary: "hexBinary"
};

/** Falls back to "string" for any built-in local name this map doesn't recognize (e.g. gYear, gMonth). */
export function mapXsdBuiltinToPrimitive(localName: string): IrPrimitiveKind {
  return BUILTIN_MAP[localName] ?? "string";
}
