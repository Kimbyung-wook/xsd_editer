import { describe, expect, it } from "vitest";
import { loadSchemaSetFromDocuments } from "../../src/parser/xsdLoader.js";
import { scanIncludeHrefs } from "../../src/parser/scanIncludes.js";
import type { ComplexTypeDecl, ElementDecl } from "../../src/model/types.js";
import type { SchemaModel } from "../../src/model/schemaModel.js";

function byName<T extends { name: string | null }>(model: SchemaModel, name: string): T {
  for (const node of model.allNodes()) {
    if (node.name === name) return node as T;
  }
  throw new Error(`node named ${name} not found`);
}

describe("scanIncludeHrefs", () => {
  it("finds xs:import and xs:include schemaLocation/namespace attributes", () => {
    const xml = `<?xml version="1.0"?>
      <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="urn:a">
        <xs:import namespace="urn:b" schemaLocation="b.xsd"/>
        <xs:include schemaLocation="a-common.xsd"/>
      </xs:schema>`;

    const refs = scanIncludeHrefs(xml);
    expect(refs).toEqual([
      { kind: "import", namespace: "urn:b", schemaLocation: "b.xsd" },
      { kind: "include", namespace: null, schemaLocation: "a-common.xsd" }
    ]);
  });
});

describe("loadSchemaSetFromDocuments", () => {
  const commonXml = `<?xml version="1.0"?>
    <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="urn:a">
      <xs:complexType name="BaseType">
        <xs:sequence>
          <xs:element name="id" type="xs:string"/>
        </xs:sequence>
      </xs:complexType>
    </xs:schema>`;

  const mainXmlSameNamespace = `<?xml version="1.0"?>
    <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:tns="urn:a" targetNamespace="urn:a">
      <xs:include schemaLocation="common.xsd"/>
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

  it("merges an xs:include'd document into one shared model", () => {
    const { model, schemaSet } = loadSchemaSetFromDocuments([
      { fileId: "main", filePath: "main.xsd", xml: mainXmlSameNamespace },
      { fileId: "common", filePath: "common.xsd", xml: commonXml }
    ]);

    expect(schemaSet.primaryFileId).toBe("main");
    expect(Object.keys(schemaSet.documents)).toEqual(["main", "common"]);

    const base = byName<ComplexTypeDecl>(model, "BaseType");
    const derived = byName<ComplexTypeDecl>(model, "DerivedType");
    expect(derived.derivation?.baseRef.qname).toEqual({ namespaceURI: "urn:a", localName: "BaseType" });
    expect(base.sourceRef?.fileId).toBe("common");
    expect(derived.sourceRef?.fileId).toBe("main");
  });

  it("resolves a cross-namespace xs:import reference against the imported document's declarations", () => {
    const bXml = `<?xml version="1.0"?>
      <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="urn:b">
        <xs:element name="Shared" type="xs:string"/>
      </xs:schema>`;
    const aXml = `<?xml version="1.0"?>
      <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:b="urn:b" targetNamespace="urn:a">
        <xs:import namespace="urn:b" schemaLocation="b.xsd"/>
        <xs:element name="UsesShared" type="xs:string"/>
      </xs:schema>`;

    const { model } = loadSchemaSetFromDocuments([
      { fileId: "a", filePath: "a.xsd", xml: aXml },
      { fileId: "b", filePath: "b.xsd", xml: bXml }
    ]);

    const shared = byName<ElementDecl>(model, "Shared");
    expect(shared.namespaceURI).toBe("urn:b");
    expect(model.findByQName("element", { namespaceURI: "urn:b", localName: "Shared" })).toBe(shared.id);
  });
});
