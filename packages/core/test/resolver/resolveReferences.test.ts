import { describe, expect, it } from "vitest";
import { loadSchemaFromString } from "../../src/parser/xsdLoader.js";
import { buildDependencyGraph } from "../../src/resolver/resolveReferences.js";
import type { ComplexTypeDecl, ElementDecl, SimpleTypeDecl } from "../../src/model/types.js";
import type { SchemaModel } from "../../src/model/schemaModel.js";

function byName<T extends { name: string | null }>(model: SchemaModel, name: string): T {
  for (const node of model.allNodes()) {
    if (node.name === name) return node as T;
  }
  throw new Error(`node named ${name} not found`);
}

const xml = `<?xml version="1.0"?>
  <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:tns="urn:example" targetNamespace="urn:example">
    <xs:simpleType name="StatusType">
      <xs:restriction base="xs:string">
        <xs:enumeration value="A"/>
      </xs:restriction>
    </xs:simpleType>
    <xs:complexType name="BaseType">
      <xs:sequence>
        <xs:element name="status" type="tns:StatusType"/>
      </xs:sequence>
    </xs:complexType>
    <xs:complexType name="DerivedType">
      <xs:complexContent>
        <xs:extension base="tns:BaseType">
          <xs:sequence/>
        </xs:extension>
      </xs:complexContent>
    </xs:complexType>
    <xs:element name="Base" type="tns:BaseType"/>
    <xs:element name="Derived" type="tns:DerivedType"/>
  </xs:schema>`;

describe("buildDependencyGraph", () => {
  it("resolves element type references, extension edges, and reverse lookups", () => {
    const { model } = loadSchemaFromString(xml, "f1", "example.xsd");
    const graph = buildDependencyGraph(model);

    const baseElement = byName<ElementDecl>(model, "Base");
    const baseType = byName<ComplexTypeDecl>(model, "BaseType");
    const derivedType = byName<ComplexTypeDecl>(model, "DerivedType");
    const statusType = byName<SimpleTypeDecl>(model, "StatusType");

    const fromBaseElement = graph.getReferencesFrom(baseElement.id);
    expect(fromBaseElement).toEqual([{ from: baseElement.id, to: baseType.id, kind: "referencesType" }]);

    const fromDerivedType = graph.getReferencesFrom(derivedType.id);
    expect(fromDerivedType).toEqual([{ from: derivedType.id, to: baseType.id, kind: "extends" }]);

    // reverse lookup: what references BaseType?
    const referencingBaseType = graph.getReferencesTo(baseType.id).map((e) => e.from);
    expect(referencingBaseType).toContain(baseElement.id);
    expect(referencingBaseType).toContain(derivedType.id);

    // extension chain from DerivedType should walk to BaseType
    expect(graph.getExtensionChain(derivedType.id)).toEqual([derivedType.id, baseType.id]);

    // sanity: statusType is referenced from within BaseType's sequence (the element inside it)
    const referencingStatus = graph.getReferencesTo(statusType.id);
    expect(referencingStatus.length).toBeGreaterThan(0);
  });

  it("produces no edge for a dangling or built-in-only type reference", () => {
    const danglingXml = `<?xml version="1.0"?>
      <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="urn:example">
        <xs:element name="Orphan" type="xs:string"/>
      </xs:schema>`;
    const { model } = loadSchemaFromString(danglingXml, "f1", "orphan.xsd");
    const graph = buildDependencyGraph(model);
    const orphan = byName<ElementDecl>(model, "Orphan");
    expect(graph.getReferencesFrom(orphan.id)).toEqual([]);
  });
});
