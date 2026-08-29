import { describe, expect, it } from "vitest";
import { loadSchemaFromString } from "../../src/parser/xsdLoader.js";
import { serializeSchemaSet } from "../../src/serializer/xsdWriter.js";
import { SetFieldCommand } from "../../src/commands/setFieldCommand.js";
import { AddChildCommand, RemoveChildCommand, compositorParticles, complexTypeAttributes } from "../../src/commands/structuralCommands.js";
import type { AnyNode, AttributeDecl, ComplexTypeDecl, CompositorNode, ElementDecl, SimpleTypeDecl } from "../../src/model/types.js";
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

  it("round-trips a xs:any wildcard's attributes edited in place", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="urn:example">
  <xs:complexType name="Extensible">
    <xs:sequence>
      <xs:element name="known" type="xs:string"/>
      <xs:any namespace="##other" processContents="lax" minOccurs="0"/>
    </xs:sequence>
  </xs:complexType>
</xs:schema>
`;
    const { model } = loadSchemaFromString(xml, "f1", "any.xsd");
    const type = byName<ComplexTypeDecl>(model, "Extensible");
    const sequence = model.getNode(type.contentModelId!) as CompositorNode;
    const wildcardId = sequence.particleIds[1];

    const output = (() => {
      new SetFieldCommand<AnyNode>(wildcardId, (n) => ({ ...n, namespace: "##any", processContents: "skip" }), "edit wildcard").apply(model);
      const [result] = serializeSchemaSet([{ fileId: "f1", filePath: "any.xsd", xml }], model);
      return result.xml;
    })();

    expect(output).toMatch(/<xs:any namespace="##any"[^>]*processContents="skip"[^>]*\/>/);
    const { model: reparsed } = loadSchemaFromString(output, "f1", "any.xsd");
    const reparsedType = byName<ComplexTypeDecl>(reparsed, "Extensible");
    const reparsedSequence = reparsed.getNode(reparsedType.contentModelId!) as CompositorNode;
    expect(reparsedSequence.particleIds).toHaveLength(2);
  });

  it("round-trips switching a simpleType from restriction to xs:list", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="urn:example">
  <xs:simpleType name="Tags">
    <xs:restriction base="xs:string">
      <xs:enumeration value="a"/>
    </xs:restriction>
  </xs:simpleType>
</xs:schema>
`;
    const { model } = loadSchemaFromString(xml, "f1", "tags.xsd");
    const output = (() => {
      const tags = byName<SimpleTypeDecl>(model, "Tags");
      new SetFieldCommand<SimpleTypeDecl>(
        tags.id,
        (n) => ({
          ...n,
          variant: "list",
          baseRef: null,
          itemTypeRef: { qname: { namespaceURI: "http://www.w3.org/2001/XMLSchema", localName: "string" }, resolvedTargetId: null }
        }),
        "switch to list"
      ).apply(model);
      const [result] = serializeSchemaSet([{ fileId: "f1", filePath: "tags.xsd", xml }], model);
      return result.xml;
    })();

    expect(output).toContain('<xs:list itemType="xs:string"/>');
    expect(output).not.toContain("xs:restriction");
    const { model: reparsed } = loadSchemaFromString(output, "f1", "tags.xsd");
    const reparsedTags = byName<SimpleTypeDecl>(reparsed, "Tags");
    expect(reparsedTags.variant).toBe("list");
  });

  it("round-trips a xs:union's memberTypes", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="urn:example">
  <xs:simpleType name="IntOrString">
    <xs:union memberTypes="xs:int"/>
  </xs:simpleType>
</xs:schema>
`;
    const { model } = loadSchemaFromString(xml, "f1", "union.xsd");
    const output = (() => {
      const u = byName<SimpleTypeDecl>(model, "IntOrString");
      new SetFieldCommand<SimpleTypeDecl>(
        u.id,
        (n) => ({
          ...n,
          memberTypeRefs: [
            { qname: { namespaceURI: "http://www.w3.org/2001/XMLSchema", localName: "int" }, resolvedTargetId: null },
            { qname: { namespaceURI: "http://www.w3.org/2001/XMLSchema", localName: "string" }, resolvedTargetId: null }
          ]
        }),
        "add member type"
      ).apply(model);
      const [result] = serializeSchemaSet([{ fileId: "f1", filePath: "union.xsd", xml }], model);
      return result.xml;
    })();

    expect(output).toContain('memberTypes="xs:int xs:string"');
    const { model: reparsed } = loadSchemaFromString(output, "f1", "union.xsd");
    const reparsedUnion = byName<SimpleTypeDecl>(reparsed, "IntOrString");
    expect(reparsedUnion.memberTypeRefs).toHaveLength(2);
  });
});
