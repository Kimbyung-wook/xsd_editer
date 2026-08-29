import type { NodeId } from "../model/nodeId.js";
import type { SchemaModel } from "../model/schemaModel.js";
import type { Annotation, AttributeGroupDecl, ComplexTypeDecl, ElementDecl, GroupDecl, QNameRef, SimpleTypeDecl } from "../model/types.js";
import { XSD_NAMESPACE } from "../parser/qnameResolver.js";
import { toPascalCase } from "./naming.js";
import { mapXsdBuiltinToPrimitive, type IrPrimitiveKind } from "./typeMapping.js";
import type { CodegenWarning } from "./types.js";

export type { IrPrimitiveKind } from "./typeMapping.js";
export type { CodegenWarning } from "./types.js";

export type IrFieldType =
  | { kind: "primitive"; primitive: IrPrimitiveKind }
  | { kind: "struct"; structName: string }
  | { kind: "enum"; enumName: string };

export interface IrField {
  /** Original XSD element/attribute local name; generators apply their own casing/sanitization. */
  name: string;
  fieldType: IrFieldType;
  /** True if this field can legitimately be absent (minOccurs 0, or forced by an ancestor xs:choice/optional group). */
  optional: boolean;
  /** True if this field can occur more than once (maxOccurs > 1 / unbounded, including via an ancestor). */
  repeated: boolean;
  isAttribute: boolean;
  docs: string | null;
}

export interface IrStruct {
  name: string;
  /** Set when this type extends/restricts another *modeled* (named complexType) base; null for simpleContent-style bases (see warnings). */
  baseStructName: string | null;
  fields: IrField[];
  docs: string | null;
  sourceNodeId: NodeId;
}

export interface IrEnumMember {
  literal: string;
}

export interface IrEnum {
  name: string;
  members: IrEnumMember[];
  docs: string | null;
  sourceNodeId: NodeId;
}

export interface IrRootElement {
  name: string;
  structName: string;
}

export interface IrModel {
  structs: IrStruct[];
  enums: IrEnum[];
  rootElements: IrRootElement[];
  warnings: CodegenWarning[];
}

function annotationToDocs(annotation: Annotation | null): string | null {
  const text = annotation?.documentation.join(" ").trim();
  return text ? text : null;
}

interface BuildCtx {
  model: SchemaModel;
  complexTypeStructNames: Map<NodeId, string>;
  simpleTypeEnumNames: Map<NodeId, string>;
  warnings: CodegenWarning[];
  uniqueName: (base: string) => string;
  extraStructs: IrStruct[];
  extraEnums: IrEnum[];
}

function resolveSimpleTypeBasePrimitive(model: SchemaModel, simpleTypeId: NodeId, warnings: CodegenWarning[], visited: Set<NodeId>): IrPrimitiveKind {
  if (visited.has(simpleTypeId)) {
    warnings.push({ nodeId: simpleTypeId, message: "simpleType 기반 타입 체인에 순환 참조가 있어 string으로 대체합니다." });
    return "string";
  }
  visited.add(simpleTypeId);
  const node = model.getNode(simpleTypeId) as SimpleTypeDecl | undefined;
  if (!node) return "string";
  if (!node.baseRef) {
    warnings.push({ nodeId: simpleTypeId, message: `union/list 파생 simpleType은 지원되지 않아 string으로 대체합니다: ${node.name ?? "(익명)"}` });
    return "string";
  }
  const baseQName = node.baseRef.qname;
  if (baseQName.namespaceURI === XSD_NAMESPACE) {
    return mapXsdBuiltinToPrimitive(baseQName.localName);
  }
  const baseId = model.findByQName("simpleType", baseQName);
  if (baseId === undefined) {
    warnings.push({ nodeId: simpleTypeId, message: `기반 타입을 찾을 수 없어 string으로 대체합니다: ${baseQName.localName}` });
    return "string";
  }
  return resolveSimpleTypeBasePrimitive(model, baseId, warnings, visited);
}

function resolveFieldType(typeRef: QNameRef | NodeId | null, namePrefix: string, ctx: BuildCtx): IrFieldType {
  const { model } = ctx;
  if (typeRef === null) {
    ctx.warnings.push({ message: `타입이 지정되지 않아 string으로 대체합니다: ${namePrefix}` });
    return { kind: "primitive", primitive: "string" };
  }

  if (typeof typeRef === "object") {
    const qname = typeRef.qname;
    if (qname.namespaceURI === XSD_NAMESPACE) {
      return { kind: "primitive", primitive: mapXsdBuiltinToPrimitive(qname.localName) };
    }
    const complexTypeId = model.findByQName("complexType", qname);
    if (complexTypeId !== undefined) {
      const structName = ctx.complexTypeStructNames.get(complexTypeId);
      if (structName) return { kind: "struct", structName };
    }
    const simpleTypeId = model.findByQName("simpleType", qname);
    if (simpleTypeId !== undefined) {
      const enumName = ctx.simpleTypeEnumNames.get(simpleTypeId);
      if (enumName) return { kind: "enum", enumName };
      return { kind: "primitive", primitive: resolveSimpleTypeBasePrimitive(model, simpleTypeId, ctx.warnings, new Set()) };
    }
    ctx.warnings.push({ message: `참조된 타입을 찾을 수 없어 string으로 대체합니다: ${qname.namespaceURI ? `{${qname.namespaceURI}}` : ""}${qname.localName}` });
    return { kind: "primitive", primitive: "string" };
  }

  // Anonymous inline type: typeRef is the NodeId of a synthesized simpleType/complexType node.
  const inlineNode = model.getNode(typeRef);
  if (!inlineNode) {
    ctx.warnings.push({ message: `인라인 타입을 찾을 수 없어 string으로 대체합니다: ${namePrefix}` });
    return { kind: "primitive", primitive: "string" };
  }
  if (inlineNode.kind === "simpleType") {
    if (inlineNode.facets.enumeration && inlineNode.facets.enumeration.length > 0) {
      const enumName = ctx.uniqueName(toPascalCase(`${namePrefix}Enum`));
      ctx.extraEnums.push({
        name: enumName,
        members: inlineNode.facets.enumeration.map((literal) => ({ literal })),
        docs: annotationToDocs(inlineNode.annotation),
        sourceNodeId: inlineNode.id
      });
      return { kind: "enum", enumName };
    }
    return { kind: "primitive", primitive: resolveSimpleTypeBasePrimitive(model, inlineNode.id, ctx.warnings, new Set()) };
  }
  if (inlineNode.kind === "complexType") {
    const structName = ctx.uniqueName(toPascalCase(`${namePrefix}Type`));
    const struct = buildStruct(inlineNode, structName, ctx);
    ctx.extraStructs.push(struct);
    return { kind: "struct", structName };
  }
  ctx.warnings.push({ message: `지원되지 않는 인라인 타입 종류(${inlineNode.kind})라 string으로 대체합니다: ${namePrefix}` });
  return { kind: "primitive", primitive: "string" };
}

function collectAttributeIds(model: SchemaModel, directIds: NodeId[], groupRefs: QNameRef[], visitedGroups: Set<NodeId>): NodeId[] {
  let result = [...directIds];
  for (const ref of groupRefs) {
    const groupId = model.findByQName("attributeGroup", ref.qname);
    if (groupId === undefined || visitedGroups.has(groupId)) continue;
    visitedGroups.add(groupId);
    const groupNode = model.getNode(groupId) as AttributeGroupDecl | undefined;
    if (!groupNode) continue;
    result = result.concat(collectAttributeIds(model, groupNode.attributeIds, groupNode.attributeGroupRefs, visitedGroups));
  }
  return result;
}

function buildStruct(complexType: ComplexTypeDecl, structName: string, ctx: BuildCtx): IrStruct {
  const { model } = ctx;
  const fields: IrField[] = [];

  function addField(name: string, typeRef: QNameRef | NodeId | null, ownMin: number, forcedOptional: boolean, forcedRepeated: boolean, ownMax: number | "unbounded", annotation: Annotation | null, isAttribute: boolean): void {
    const optional = forcedOptional || ownMin === 0;
    const repeated = forcedRepeated || ownMax === "unbounded" || (typeof ownMax === "number" && ownMax > 1);
    const fieldType = resolveFieldType(typeRef, `${structName}_${name}`, ctx);
    fields.push({ name, fieldType, optional, repeated, isAttribute, docs: annotationToDocs(annotation) });
  }

  function walk(particleId: NodeId, ancestorForcedOptional: boolean, ancestorForcedRepeated: boolean, visitedGroups: Set<NodeId>): void {
    const node = model.getNode(particleId);
    if (!node) return;
    switch (node.kind) {
      case "compositor": {
        const childOptional = ancestorForcedOptional || node.compositor === "choice" || node.minOccurs === 0;
        const childRepeated = ancestorForcedRepeated || node.maxOccurs === "unbounded" || (typeof node.maxOccurs === "number" && node.maxOccurs > 1);
        for (const childId of node.particleIds) {
          walk(childId, childOptional, childRepeated, visitedGroups);
        }
        break;
      }
      case "groupRef": {
        const targetGroupId = model.findByQName("group", node.ref.qname);
        if (targetGroupId === undefined || visitedGroups.has(targetGroupId)) {
          if (targetGroupId !== undefined) {
            ctx.warnings.push({ nodeId: node.id, message: "group 참조에 순환이 있어 일부 필드가 생략되었습니다." });
          }
          return;
        }
        const groupNode = model.getNode(targetGroupId) as GroupDecl | undefined;
        if (!groupNode?.contentModelId) return;
        const childOptional = ancestorForcedOptional || node.minOccurs === 0;
        const childRepeated = ancestorForcedRepeated || node.maxOccurs === "unbounded" || (typeof node.maxOccurs === "number" && node.maxOccurs > 1);
        const nextVisited = new Set(visitedGroups);
        nextVisited.add(targetGroupId);
        walk(groupNode.contentModelId, childOptional, childRepeated, nextVisited);
        break;
      }
      case "elementRef": {
        const targetId = model.findByQName("element", node.ref.qname);
        const target = targetId !== undefined ? (model.getNode(targetId) as ElementDecl | undefined) : undefined;
        const fieldName = target?.name ?? node.ref.qname.localName;
        addField(fieldName, target?.typeRef ?? null, node.minOccurs, ancestorForcedOptional, ancestorForcedRepeated, node.maxOccurs, target?.annotation ?? null, false);
        break;
      }
      case "element": {
        addField(node.name ?? "value", node.typeRef, node.minOccurs, ancestorForcedOptional, ancestorForcedRepeated, node.maxOccurs, node.annotation, false);
        break;
      }
      default:
        break;
    }
  }

  if (complexType.contentModelId) {
    walk(complexType.contentModelId, false, false, new Set());
  }

  for (const attrId of collectAttributeIds(model, complexType.attributeIds, complexType.attributeGroupRefs, new Set())) {
    const attr = model.getNode(attrId);
    if (!attr || attr.kind !== "attribute") continue;
    if (attr.use === "prohibited") continue;
    let name = attr.name;
    let typeRef = attr.typeRef;
    let annotation = attr.annotation;
    if (attr.ref) {
      const targetId = model.findByQName("attribute", attr.ref.qname);
      const target = targetId !== undefined ? model.getNode(targetId) : undefined;
      if (target && target.kind === "attribute") {
        name = target.name;
        typeRef = target.typeRef;
        annotation = target.annotation;
      } else {
        name = attr.ref.qname.localName;
      }
    }
    if (name === null) continue;
    addField(name, typeRef, attr.use === "required" ? 1 : 0, false, false, 1, annotation, true);
  }

  let baseStructName: string | null = null;
  if (complexType.derivation) {
    if (complexType.derivation.kind === "restriction") {
      ctx.warnings.push({
        nodeId: complexType.id,
        message: `${structName}: complexType restriction은 extension과 동일하게 필드가 병합되어 근사됩니다 (원본 narrowing 규칙은 반영되지 않음).`
      });
    }
    const baseQName = complexType.derivation.baseRef.qname;
    const baseComplexTypeId = baseQName.namespaceURI !== XSD_NAMESPACE ? model.findByQName("complexType", baseQName) : undefined;
    if (baseComplexTypeId !== undefined) {
      baseStructName = ctx.complexTypeStructNames.get(baseComplexTypeId) ?? null;
    } else {
      ctx.warnings.push({
        nodeId: complexType.id,
        message: `${structName}: simpleContent 파생으로 보이며(base=${baseQName.localName}) 텍스트 값 필드는 생성되지 않고 속성만 반영됩니다.`
      });
    }
  }

  return {
    name: structName,
    baseStructName,
    fields,
    docs: annotationToDocs(complexType.annotation),
    sourceNodeId: complexType.id
  };
}

/**
 * Builds the language-independent codegen IR from a SchemaModel (docs/PLAN.md codegen/ir.ts).
 * Only named (top-level) complexType/simpleType declarations become emitted structs/enums;
 * anonymous inline types are synthesized on demand with a `<Parent>_<field>Type` name.
 */
export function buildCodegenIr(model: SchemaModel): IrModel {
  const warnings: CodegenWarning[] = [];
  const usedNames = new Set<string>();
  function uniqueName(base: string): string {
    let candidate = base;
    let n = 2;
    while (usedNames.has(candidate)) {
      candidate = `${base}${n}`;
      n += 1;
    }
    usedNames.add(candidate);
    return candidate;
  }

  const complexTypeNodes: ComplexTypeDecl[] = [];
  const simpleTypeNodes: SimpleTypeDecl[] = [];
  for (const node of model.allNodes()) {
    if (node.kind === "complexType" && node.name !== null) complexTypeNodes.push(node);
    else if (node.kind === "simpleType" && node.name !== null) simpleTypeNodes.push(node);
  }

  const simpleTypeEnumNames = new Map<NodeId, string>();
  const enums: IrEnum[] = [];
  for (const st of simpleTypeNodes) {
    if (st.facets.enumeration && st.facets.enumeration.length > 0) {
      const enumName = uniqueName(toPascalCase(st.name as string));
      simpleTypeEnumNames.set(st.id, enumName);
      enums.push({
        name: enumName,
        members: st.facets.enumeration.map((literal) => ({ literal })),
        docs: annotationToDocs(st.annotation),
        sourceNodeId: st.id
      });
    }
  }

  const complexTypeStructNames = new Map<NodeId, string>();
  for (const ct of complexTypeNodes) {
    complexTypeStructNames.set(ct.id, uniqueName(toPascalCase(ct.name as string)));
  }

  const extraStructs: IrStruct[] = [];
  const extraEnums: IrEnum[] = [];
  const ctx: BuildCtx = { model, complexTypeStructNames, simpleTypeEnumNames, warnings, uniqueName, extraStructs, extraEnums };

  const structs: IrStruct[] = complexTypeNodes.map((ct) => buildStruct(ct, complexTypeStructNames.get(ct.id) as string, ctx));
  structs.push(...extraStructs);
  enums.push(...extraEnums);

  const topLevelIds = new Set<NodeId>();
  const schemaSet = model.getSchemaSet();
  if (schemaSet) {
    for (const doc of Object.values(schemaSet.documents)) {
      for (const id of doc.topLevelNodeIds) topLevelIds.add(id);
    }
  }

  const rootElements: IrRootElement[] = [];
  for (const id of topLevelIds) {
    const node = model.getNode(id);
    if (!node || node.kind !== "element" || node.name === null || node.typeRef === null || typeof node.typeRef !== "object") continue;
    const complexTypeId = model.findByQName("complexType", node.typeRef.qname);
    const structName = complexTypeId !== undefined ? complexTypeStructNames.get(complexTypeId) : undefined;
    if (structName) rootElements.push({ name: node.name, structName });
  }

  return { structs, enums, rootElements, warnings };
}
