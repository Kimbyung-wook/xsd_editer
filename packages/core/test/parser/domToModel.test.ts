import { describe, expect, it } from "vitest";
import { loadSchemaFromString } from "../../src/parser/xsdLoader.js";
import type {
  AnyNode,
  AttributeDecl,
  ComplexTypeDecl,
  CompositorNode,
  ElementDecl,
  ElementRefNode,
  GroupDecl,
  GroupRefNode,
  SimpleTypeDecl
} from "../../src/model/types.js";
import type { SchemaModel } from "../../src/model/schemaModel.js";

function byName<T extends { name: string | null }>(model: SchemaModel, name: string): T {
  for (const node of model.allNodes()) {
    if (node.name === name) return node as T;
  }
  throw new Error(`node named ${name} not found`);
}

describe("loadSchemaFromString", () => {
  it("parses a top-level element with an inline complexType, sequence and attribute", () => {
    const xml = `<?xml version="1.0"?>
      <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"
                 targetNamespace="urn:example"
                 xmlns:tns="urn:example"
                 elementFormDefault="qualified">
        <xs:element name="Person">
          <xs:complexType>
            <xs:sequence>
              <xs:element name="firstName" type="xs:string"/>
              <xs:element name="age" type="xs:int" minOccurs="0"/>
            </xs:sequence>
            <xs:attribute name="id" type="xs:string" use="required"/>
          </xs:complexType>
        </xs:element>
      </xs:schema>`;

    const { model, schemaSet } = loadSchemaFromString(xml, "f1", "person.xsd");

    expect(schemaSet.primaryFileId).toBe("f1");
    expect(schemaSet.documents.f1.targetNamespace).toBe("urn:example");

    const person = byName<ElementDecl>(model, "Person");
    expect(person.kind).toBe("element");
    expect(person.namespaceURI).toBe("urn:example");

    const inlineType = model.getNode(person.typeRef as any) as ComplexTypeDecl;
    expect(inlineType.kind).toBe("complexType");
    expect(inlineType.attributeIds).toHaveLength(1);

    const attribute = model.getNode(inlineType.attributeIds[0]) as AttributeDecl;
    expect(attribute.name).toBe("id");
    expect(attribute.use).toBe("required");

    const sequence = model.getNode(inlineType.contentModelId!) as CompositorNode;
    expect(sequence.compositor).toBe("sequence");
    expect(sequence.particleIds).toHaveLength(2);

    const age = model.getNode(sequence.particleIds[1]) as ElementDecl;
    expect(age.name).toBe("age");
    expect(age.minOccurs).toBe(0);
    expect(age.maxOccurs).toBe(1);
  });

  it("resolves QName-valued attributes using the in-scope xmlns prefix map", () => {
    const xml = `<?xml version="1.0"?>
      <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"
                 targetNamespace="urn:example"
                 xmlns:tns="urn:example">
        <xs:complexType name="BaseType">
          <xs:sequence/>
        </xs:complexType>
        <xs:complexType name="DerivedType">
          <xs:complexContent>
            <xs:extension base="tns:BaseType">
              <xs:sequence>
                <xs:element name="extra" type="xs:string"/>
              </xs:sequence>
            </xs:extension>
          </xs:complexContent>
        </xs:complexType>
      </xs:schema>`;

    const { model } = loadSchemaFromString(xml, "f1", "types.xsd");
    const derived = byName<ComplexTypeDecl>(model, "DerivedType");

    expect(derived.derivation?.kind).toBe("extension");
    expect(derived.derivation?.baseRef.qname).toEqual({ namespaceURI: "urn:example", localName: "BaseType" });

    const sequence = model.getNode(derived.contentModelId!) as CompositorNode;
    expect(sequence.particleIds).toHaveLength(1);
  });

  it("parses nested compositors (choice inside sequence) and element/group references", () => {
    const xml = `<?xml version="1.0"?>
      <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="urn:example">
        <xs:element name="shared" type="xs:string"/>
        <xs:group name="ContactGroup">
          <xs:sequence>
            <xs:element name="email" type="xs:string"/>
          </xs:sequence>
        </xs:group>
        <xs:complexType name="Root">
          <xs:sequence>
            <xs:element ref="shared"/>
            <xs:choice minOccurs="0" maxOccurs="unbounded">
              <xs:element name="a" type="xs:string"/>
              <xs:element name="b" type="xs:string"/>
            </xs:choice>
            <xs:group ref="ContactGroup"/>
          </xs:sequence>
        </xs:complexType>
      </xs:schema>`;

    const { model } = loadSchemaFromString(xml, "f1", "nested.xsd");
    const root = byName<ComplexTypeDecl>(model, "Root");
    const sequence = model.getNode(root.contentModelId!) as CompositorNode;
    expect(sequence.particleIds).toHaveLength(3);

    const elementRef = model.getNode(sequence.particleIds[0]) as ElementRefNode;
    expect(elementRef.kind).toBe("elementRef");
    expect(elementRef.ref.qname.localName).toBe("shared");

    const choice = model.getNode(sequence.particleIds[1]) as CompositorNode;
    expect(choice.compositor).toBe("choice");
    expect(choice.maxOccurs).toBe("unbounded");
    expect(choice.particleIds).toHaveLength(2);

    const groupRef = model.getNode(sequence.particleIds[2]) as GroupRefNode;
    expect(groupRef.kind).toBe("groupRef");
    expect(groupRef.ref.qname.localName).toBe("ContactGroup");

    const group = byName<GroupDecl>(model, "ContactGroup");
    const groupSequence = model.getNode(group.contentModelId!) as CompositorNode;
    expect(groupSequence.particleIds).toHaveLength(1);
  });

  it("parses simpleType restriction facets including enumeration", () => {
    const xml = `<?xml version="1.0"?>
      <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="urn:example">
        <xs:simpleType name="Status">
          <xs:restriction base="xs:string">
            <xs:enumeration value="ACTIVE"/>
            <xs:enumeration value="INACTIVE"/>
            <xs:pattern value="[A-Z]+"/>
          </xs:restriction>
        </xs:simpleType>
        <xs:simpleType name="SmallInt">
          <xs:restriction base="xs:int">
            <xs:minInclusive value="0"/>
            <xs:maxInclusive value="100"/>
          </xs:restriction>
        </xs:simpleType>
      </xs:schema>`;

    const { model } = loadSchemaFromString(xml, "f1", "simple.xsd");
    const status = byName<SimpleTypeDecl>(model, "Status");
    expect(status.baseRef?.qname.localName).toBe("string");
    expect(status.facets.enumeration).toEqual(["ACTIVE", "INACTIVE"]);
    expect(status.facets.pattern).toBe("[A-Z]+");

    const smallInt = byName<SimpleTypeDecl>(model, "SmallInt");
    expect(smallInt.facets.minInclusive).toBe("0");
    expect(smallInt.facets.maxInclusive).toBe("100");
  });

  it("captures xs:documentation text as the node annotation", () => {
    const xml = `<?xml version="1.0"?>
      <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="urn:example">
        <xs:element name="Documented" type="xs:string">
          <xs:annotation>
            <xs:documentation>Some helpful text.</xs:documentation>
          </xs:annotation>
        </xs:element>
      </xs:schema>`;

    const { model } = loadSchemaFromString(xml, "f1", "doc.xsd");
    const el = byName<ElementDecl>(model, "Documented");
    expect(el.annotation?.documentation).toEqual(["Some helpful text."]);
  });

  it("records a relocatable source path for each parsed node", () => {
    const xml = `<?xml version="1.0"?>
      <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="urn:example">
        <xs:element name="Root" type="xs:string"/>
      </xs:schema>`;

    const { model } = loadSchemaFromString(xml, "f1", "root.xsd");
    const el = byName<ElementDecl>(model, "Root");
    expect(el.sourceRef?.fileId).toBe("f1");
    expect(el.sourceRef?.path.length).toBeGreaterThan(0);
  });

  it("parses a xs:any wildcard particle inside a compositor", () => {
    const xml = `<?xml version="1.0"?>
      <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="urn:example">
        <xs:complexType name="Extensible">
          <xs:sequence>
            <xs:element name="known" type="xs:string"/>
            <xs:any namespace="##other" processContents="lax" minOccurs="0" maxOccurs="unbounded"/>
          </xs:sequence>
        </xs:complexType>
      </xs:schema>`;
    const { model } = loadSchemaFromString(xml, "f1", "any.xsd");
    const type = byName<ComplexTypeDecl>(model, "Extensible");
    const sequence = model.getNode(type.contentModelId!) as CompositorNode;
    expect(sequence.particleIds).toHaveLength(2);
    const wildcard = model.getNode(sequence.particleIds[1]) as AnyNode;
    expect(wildcard.kind).toBe("any");
    expect(wildcard.namespace).toBe("##other");
    expect(wildcard.processContents).toBe("lax");
    expect(wildcard.minOccurs).toBe(0);
    expect(wildcard.maxOccurs).toBe("unbounded");
  });

  it("defaults xs:any processContents to strict when unspecified", () => {
    const xml = `<?xml version="1.0"?>
      <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="urn:example">
        <xs:complexType name="Plain">
          <xs:sequence>
            <xs:any/>
          </xs:sequence>
        </xs:complexType>
      </xs:schema>`;
    const { model } = loadSchemaFromString(xml, "f1", "any2.xsd");
    const type = byName<ComplexTypeDecl>(model, "Plain");
    const sequence = model.getNode(type.contentModelId!) as CompositorNode;
    const wildcard = model.getNode(sequence.particleIds[0]) as AnyNode;
    expect(wildcard.processContents).toBe("strict");
    expect(wildcard.namespace).toBeNull();
  });

  it("parses a xs:list simpleType's itemType", () => {
    const xml = `<?xml version="1.0"?>
      <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="urn:example">
        <xs:simpleType name="IntList">
          <xs:list itemType="xs:int"/>
        </xs:simpleType>
      </xs:schema>`;
    const { model } = loadSchemaFromString(xml, "f1", "list.xsd");
    const listType = byName<SimpleTypeDecl>(model, "IntList");
    expect(listType.variant).toBe("list");
    expect(listType.itemTypeRef?.qname).toEqual({ namespaceURI: "http://www.w3.org/2001/XMLSchema", localName: "int" });
    expect(listType.baseRef).toBeNull();
  });

  it("parses a xs:union simpleType's memberTypes", () => {
    const xml = `<?xml version="1.0"?>
      <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"
                 xmlns:tns="urn:example"
                 targetNamespace="urn:example">
        <xs:simpleType name="Named">
          <xs:restriction base="xs:string"><xs:enumeration value="x"/></xs:restriction>
        </xs:simpleType>
        <xs:simpleType name="IntOrNamed">
          <xs:union memberTypes="xs:int tns:Named"/>
        </xs:simpleType>
      </xs:schema>`;
    const { model } = loadSchemaFromString(xml, "f1", "union.xsd");
    const unionType = byName<SimpleTypeDecl>(model, "IntOrNamed");
    expect(unionType.variant).toBe("union");
    expect(unionType.memberTypeRefs.map((r) => r.qname)).toEqual([
      { namespaceURI: "http://www.w3.org/2001/XMLSchema", localName: "int" },
      { namespaceURI: "urn:example", localName: "Named" }
    ]);
  });
});
