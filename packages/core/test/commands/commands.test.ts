import { describe, expect, it } from "vitest";
import { loadSchemaFromString } from "../../src/parser/xsdLoader.js";
import { SetFieldCommand } from "../../src/commands/setFieldCommand.js";
import { AddChildCommand, RemoveChildCommand, compositorParticles, complexTypeAttributes } from "../../src/commands/structuralCommands.js";
import type { AttributeDecl, ComplexTypeDecl, CompositorNode, ElementDecl } from "../../src/model/types.js";
import type { SchemaModel } from "../../src/model/schemaModel.js";

function byName<T extends { name: string | null }>(model: SchemaModel, name: string): T {
  for (const node of model.allNodes()) {
    if (node.name === name) return node as T;
  }
  throw new Error(`node named ${name} not found`);
}

const xml = `<?xml version="1.0"?>
  <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="urn:example">
    <xs:complexType name="PersonType">
      <xs:sequence>
        <xs:element name="firstName" type="xs:string"/>
      </xs:sequence>
    </xs:complexType>
  </xs:schema>`;

describe("SetFieldCommand", () => {
  it("applies a field change and inverts back to the original value", () => {
    const { model } = loadSchemaFromString(xml, "f1", "person.xsd");
    const person = byName<ComplexTypeDecl>(model, "PersonType");

    const command = new SetFieldCommand<ComplexTypeDecl>(person.id, (n) => ({ ...n, mixed: true }), "mixed 설정");
    command.apply(model);
    expect((model.getNode(person.id) as ComplexTypeDecl).mixed).toBe(true);

    const inverse = command.invert();
    inverse.apply(model);
    expect((model.getNode(person.id) as ComplexTypeDecl).mixed).toBe(false);
  });

  it("throws when inverting before apply", () => {
    const { model } = loadSchemaFromString(xml, "f1", "person.xsd");
    const person = byName<ComplexTypeDecl>(model, "PersonType");
    const command = new SetFieldCommand<ComplexTypeDecl>(person.id, (n) => ({ ...n, mixed: true }), "mixed 설정");
    expect(() => command.invert()).toThrow();
  });
});

describe("AddChildCommand / RemoveChildCommand", () => {
  it("adds a new element particle to a compositor and can undo/redo it", () => {
    const { model } = loadSchemaFromString(xml, "f1", "person.xsd");
    const person = byName<ComplexTypeDecl>(model, "PersonType");
    const sequence = model.getNode(person.contentModelId!) as CompositorNode;
    expect(sequence.particleIds).toHaveLength(1);

    const addCommand = new AddChildCommand<CompositorNode>(
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
      "요소 추가: lastName"
    );

    addCommand.apply(model);
    const afterAdd = model.getNode(person.contentModelId!) as CompositorNode;
    expect(afterAdd.particleIds).toHaveLength(2);
    const newElementId = afterAdd.particleIds[1];
    expect((model.getNode(newElementId) as ElementDecl).name).toBe("lastName");

    // undo
    const undo = addCommand.invert();
    undo.apply(model);
    expect((model.getNode(person.contentModelId!) as CompositorNode).particleIds).toHaveLength(1);
    expect(model.getNode(newElementId)).toBeUndefined();

    // redo (re-apply the original add command; id is stable across re-application)
    addCommand.apply(model);
    const afterRedo = model.getNode(person.contentModelId!) as CompositorNode;
    expect(afterRedo.particleIds).toEqual([sequence.particleIds[0], newElementId]);
  });

  it("removing a compositor also cascades to its own particles, and restore brings them all back", () => {
    const { model } = loadSchemaFromString(xml, "f1", "person.xsd");
    const person = byName<ComplexTypeDecl>(model, "PersonType");
    const sequence = model.getNode(person.contentModelId!) as CompositorNode;
    const firstNameId = sequence.particleIds[0];

    const removeCommand = new RemoveChildCommand<CompositorNode>(sequence.id, compositorParticles, firstNameId, "요소 삭제: firstName");
    removeCommand.apply(model);
    expect((model.getNode(sequence.id) as CompositorNode).particleIds).toHaveLength(0);
    expect(model.getNode(firstNameId)).toBeUndefined();

    const restore = removeCommand.invert();
    restore.apply(model);
    expect((model.getNode(sequence.id) as CompositorNode).particleIds).toEqual([firstNameId]);
    expect((model.getNode(firstNameId) as ElementDecl).name).toBe("firstName");
  });

  it("adds a new attribute to a complexType via the attributeIds list field", () => {
    const { model } = loadSchemaFromString(xml, "f1", "person.xsd");
    const person = byName<ComplexTypeDecl>(model, "PersonType");
    expect(person.attributeIds).toHaveLength(0);

    const addAttr = new AddChildCommand<ComplexTypeDecl>(
      person.id,
      complexTypeAttributes,
      "attribute",
      (id): AttributeDecl => ({
        id,
        kind: "attribute",
        name: "id",
        namespaceURI: null,
        annotation: null,
        sourceRef: null,
        ref: null,
        typeRef: { qname: { namespaceURI: "http://www.w3.org/2001/XMLSchema", localName: "string" }, resolvedTargetId: null },
        use: "required",
        default: null,
        fixed: null
      }),
      null,
      "속성 추가: id"
    );
    addAttr.apply(model);
    const updated = model.getNode(person.id) as ComplexTypeDecl;
    expect(updated.attributeIds).toHaveLength(1);
    expect((model.getNode(updated.attributeIds[0]) as AttributeDecl).use).toBe("required");
  });
});
