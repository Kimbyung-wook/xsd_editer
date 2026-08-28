import { describe, expect, it } from "vitest";
import { nextId, SchemaModel } from "../../src/model/schemaModel.js";
import type { ComplexTypeDecl, ElementDecl } from "../../src/model/types.js";

function makeComplexType(name: string): ComplexTypeDecl {
  return {
    id: nextId("complexType"),
    kind: "complexType",
    name,
    namespaceURI: "urn:example",
    annotation: null,
    sourceRef: null,
    abstract: false,
    mixed: false,
    derivation: null,
    contentModelId: null,
    attributeIds: [],
    attributeGroupRefs: []
  };
}

function makeElement(name: string, typeId: ElementDecl["typeRef"]): ElementDecl {
  return {
    id: nextId("element"),
    kind: "element",
    name,
    namespaceURI: "urn:example",
    annotation: null,
    sourceRef: null,
    typeRef: typeId,
    minOccurs: 1,
    maxOccurs: 1,
    nillable: false,
    default: null,
    fixed: null,
    abstract: false,
    substitutionGroupRef: null
  };
}

describe("SchemaModel", () => {
  it("stores nodes and finds them by id", () => {
    const model = new SchemaModel();
    const type = makeComplexType("PersonType");
    model.addNode(type);

    expect(model.getNode(type.id)).toBe(type);
  });

  it("indexes named nodes by QName within their kind", () => {
    const model = new SchemaModel();
    const type = makeComplexType("PersonType");
    model.addNode(type);

    const found = model.findByQName("complexType", { namespaceURI: "urn:example", localName: "PersonType" });
    expect(found).toBe(type.id);
  });

  it("emits a change event when a node is updated", () => {
    const model = new SchemaModel();
    const type = makeComplexType("PersonType");
    model.addNode(type);

    const events: string[] = [];
    model.onChange((event) => events.push(event.type));

    model.updateNode<ComplexTypeDecl>(type.id, (node) => ({ ...node, mixed: true }));

    expect(events).toEqual(["updated"]);
    expect((model.getNode(type.id) as ComplexTypeDecl).mixed).toBe(true);
  });

  it("supports an element referencing a complexType by NodeId", () => {
    const model = new SchemaModel();
    const type = makeComplexType("PersonType");
    model.addNode(type);
    const element = makeElement("person", type.id);
    model.addNode(element);

    const stored = model.getNode(element.id) as ElementDecl;
    expect(stored.typeRef).toBe(type.id);
  });

  it("removes nodes and emits a removed event", () => {
    const model = new SchemaModel();
    const type = makeComplexType("PersonType");
    model.addNode(type);

    const events: string[] = [];
    model.onChange((event) => events.push(event.type));
    model.removeNode(type.id);

    expect(model.getNode(type.id)).toBeUndefined();
    expect(events).toEqual(["removed"]);
  });

  it("re-indexes by QName on rename: the old name stops resolving and the new one starts", () => {
    const model = new SchemaModel();
    const type = makeComplexType("PersonType");
    model.addNode(type);

    model.updateNode<ComplexTypeDecl>(type.id, (node) => ({ ...node, name: "PersonTypeRenamed" }));

    expect(model.findByQName("complexType", { namespaceURI: "urn:example", localName: "PersonType" })).toBeUndefined();
    expect(model.findByQName("complexType", { namespaceURI: "urn:example", localName: "PersonTypeRenamed" })).toBe(type.id);
  });

  it("clears the QName index entry when a node is removed", () => {
    const model = new SchemaModel();
    const type = makeComplexType("PersonType");
    model.addNode(type);
    model.removeNode(type.id);

    expect(model.findByQName("complexType", { namespaceURI: "urn:example", localName: "PersonType" })).toBeUndefined();
  });

  it("does not let removing a duplicate-named node clobber the surviving node's QName index entry", () => {
    const model = new SchemaModel();
    const first = makeComplexType("Dup");
    const second = makeComplexType("Dup");
    model.addNode(first);
    model.addNode(second); // second wins the index slot for this QName

    model.removeNode(first.id);

    expect(model.findByQName("complexType", { namespaceURI: "urn:example", localName: "Dup" })).toBe(second.id);
  });
});
