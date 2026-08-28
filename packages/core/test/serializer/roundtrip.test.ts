import { describe, expect, it } from "vitest";
import { loadSchemaFromString } from "../../src/parser/xsdLoader.js";
import { serializeSchemaSet } from "../../src/serializer/xsdWriter.js";
import { SetFieldCommand } from "../../src/commands/setFieldCommand.js";
import { AddChildCommand, RemoveChildCommand, compositorParticles, complexTypeAttributes } from "../../src/commands/structuralCommands.js";
import type { AttributeDecl, ComplexTypeDecl, CompositorNode, ElementDecl, SimpleTypeDecl } from "../../src/model/types.js";
import type { SchemaModel } from "../../src/model/schemaModel.js";

function byName<T extends { name: string | null }>(model: SchemaModel, name: string): T {
  for (const node of model.allNodes()) {
    if (node.name === name) return node as T;
  }
  throw new Error(`node named ${name} not found`);
}

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:tns="urn:example" targetNamespace="urn:example" elementFormDefault="qualified">
  <!-- a comment that must survive untouched -->
  <xs:simpleType name="StatusType">
    <xs:restriction base="xs:string">
      <xs:enumeration value="ACTIVE"/>
      <xs:enumeration value="INACTIVE"/>
    </xs:restriction>
  </xs:simpleType>
  <xs:complexType name="PersonType">
    <xs:sequence>
      <xs:element name="firstName" type="xs:string"/>
      <xs:element name="status" type="tns:StatusType"/>
    </xs:sequence>
    <xs:attribute name="id" type="xs:string" use="required"/>
  </xs:complexType>
  <xs:element name="Person" type="tns:PersonType"/>
</xs:schema>
`;

function reserialize(xml: string, edit?: (model: SchemaModel) => void): string {
  const { model } = loadSchemaFromString(xml, "f1", "person.xsd");
  edit?.(model);
  const [result] = serializeSchemaSet([{ fileId: "f1", filePath: "person.xsd", xml }], model);
  return result.xml;
}

describe("round-trip serialization", () => {
  it("leaves an unedited document's comments and untouched regions intact", () => {
    const output = reserialize(XML);
    expect(output).toContain("<!-- a comment that must survive untouched -->");
    expect(output).toContain('<xs:enumeration value="ACTIVE"/>');
    expect(output).toContain('<xs:element name="firstName" type="xs:string"/>');
  });

  it("re-parses the unedited round-trip back to an equivalent model", () => {
    const output = reserialize(XML);
    const { model: reparsed } = loadSchemaFromString(output, "f1", "person.xsd");
    const person = byName<ComplexTypeDecl>(reparsed, "PersonType");
    expect(person.attributeIds).toHaveLength(1);
    const sequence = reparsed.getNode(person.contentModelId!) as CompositorNode;
    expect(sequence.particleIds).toHaveLength(2);
    const status = byName<SimpleTypeDecl>(reparsed, "StatusType");
    expect(status.facets.enumeration).toEqual(["ACTIVE", "INACTIVE"]);
  });

  it("round-trips a rename without disturbing the rest of the document", () => {
    const output = reserialize(XML, (model) => {
      const personType = byName<ComplexTypeDecl>(model, "PersonType");
      new SetFieldCommand<ComplexTypeDecl>(personType.id, (n) => ({ ...n, name: "PersonTypeRenamed" }), "rename").apply(model);
    });

    expect(output).toContain('name="PersonTypeRenamed"');
    expect(output).not.toMatch(/name="PersonType"(?!Renamed)/);
    expect(output).toContain("<!-- a comment that must survive untouched -->");

    const { model: reparsed } = loadSchemaFromString(output, "f1", "person.xsd");
    expect(() => byName(reparsed, "PersonTypeRenamed")).not.toThrow();
  });

  it("round-trips a facet edit and leaves other simpleTypes' facet formatting untouched", () => {
    const output = reserialize(XML, (model) => {
      const status = byName<SimpleTypeDecl>(model, "StatusType");
      new SetFieldCommand<SimpleTypeDecl>(
        status.id,
        (n) => ({ ...n, facets: { ...n.facets, enumeration: ["ACTIVE", "INACTIVE", "PENDING"] } }),
        "add enum value"
      ).apply(model);
    });

    const { model: reparsed } = loadSchemaFromString(output, "f1", "person.xsd");
    const status = byName<SimpleTypeDecl>(reparsed, "StatusType");
    expect(status.facets.enumeration).toEqual(["ACTIVE", "INACTIVE", "PENDING"]);
  });

  it("round-trips a type-ref rewire (attribute updated to the newly picked QName)", () => {
    const output = reserialize(XML, (model) => {
      const el = byName<ElementDecl>(model, "firstName");
      new SetFieldCommand<ElementDecl>(
        el.id,
        (n) => ({ ...n, typeRef: { qname: { namespaceURI: "urn:example", localName: "StatusType" }, resolvedTargetId: null } }),
        "change type"
      ).apply(model);
    });

    expect(output).toMatch(/name="firstName" type="tns:StatusType"/);
  });

  it("round-trips adding a new element particle into a sequence", () => {
    const output = reserialize(XML, (model) => {
      const person = byName<ComplexTypeDecl>(model, "PersonType");
      const sequence = model.getNode(person.contentModelId!) as CompositorNode;
      new AddChildCommand<CompositorNode>(
        sequence.id,
        compositorParticles,
        "element",
        (id): ElementDecl => ({
          id,
          kind: "element",
          name: "lastName",
          namespaceURI: null,
          annotation: null,
          sourceRef: null,
          typeRef: { qname: { namespaceURI: "http://www.w3.org/2001/XMLSchema", localName: "string" }, resolvedTargetId: null },
          minOccurs: 1,
          maxOccurs: 1,
          nillable: false,
          default: null,
          fixed: null,
          abstract: false,
          substitutionGroupRef: null
        }),
        null,
        "add lastName"
      ).apply(model);
    });

    const { model: reparsed } = loadSchemaFromString(output, "f1", "person.xsd");
    const person = byName<ComplexTypeDecl>(reparsed, "PersonType");
    const sequence = reparsed.getNode(person.contentModelId!) as CompositorNode;
    expect(sequence.particleIds).toHaveLength(3);
    const lastName = reparsed.getNode(sequence.particleIds[2]) as ElementDecl;
    expect(lastName.name).toBe("lastName");
  });

  it("round-trips deleting an attribute", () => {
    const output = reserialize(XML, (model) => {
      const person = byName<ComplexTypeDecl>(model, "PersonType");
      const attrId = person.attributeIds[0];
      new RemoveChildCommand<ComplexTypeDecl>(person.id, complexTypeAttributes, attrId, "delete id attr").apply(model);
    });

    const { model: reparsed } = loadSchemaFromString(output, "f1", "person.xsd");
    const person = byName<ComplexTypeDecl>(reparsed, "PersonType");
    expect(person.attributeIds).toHaveLength(0);
  });

  it("does not modify a document that has nothing to patch for it", () => {
    const { model } = loadSchemaFromString(XML, "f1", "person.xsd");
    const [result] = serializeSchemaSet([{ fileId: "other-file", filePath: "other.xsd", xml: "<x/>" }], model);
    expect(result.xml).toBe("<x/>");
  });
});
