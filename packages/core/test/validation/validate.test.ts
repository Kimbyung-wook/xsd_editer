import { describe, expect, it } from "vitest";
import { loadSchemaFromString } from "../../src/parser/xsdLoader.js";
import { validateModel } from "../../src/validation/validate.js";

describe("validateModel", () => {
  it("reports no diagnostics for a well-formed schema", () => {
    const xml = `<?xml version="1.0"?>
      <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:tns="urn:example" targetNamespace="urn:example">
        <xs:simpleType name="StatusType">
          <xs:restriction base="xs:string">
            <xs:enumeration value="A"/>
          </xs:restriction>
        </xs:simpleType>
        <xs:complexType name="PersonType">
          <xs:sequence>
            <xs:element name="status" type="tns:StatusType"/>
          </xs:sequence>
        </xs:complexType>
        <xs:element name="Person" type="tns:PersonType"/>
      </xs:schema>`;
    const { model } = loadSchemaFromString(xml, "f1", "ok.xsd");
    expect(validateModel(model)).toEqual([]);
  });

  it("flags a dangling type reference but not a reference to a built-in xs: type", () => {
    const xml = `<?xml version="1.0"?>
      <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:tns="urn:example" targetNamespace="urn:example">
        <xs:element name="Broken" type="tns:DoesNotExist"/>
        <xs:element name="Fine" type="xs:string"/>
      </xs:schema>`;
    const { model } = loadSchemaFromString(xml, "f1", "broken.xsd");
    const diagnostics = validateModel(model);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe("dangling-reference");
  });

  it("flags duplicate top-level names within the same namespace", () => {
    const xml = `<?xml version="1.0"?>
      <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="urn:example">
        <xs:complexType name="Dup">
          <xs:sequence/>
        </xs:complexType>
        <xs:complexType name="Dup">
          <xs:sequence/>
        </xs:complexType>
      </xs:schema>`;
    const { model } = loadSchemaFromString(xml, "f1", "dup.xsd");
    const diagnostics = validateModel(model);
    expect(diagnostics.some((d) => d.code === "duplicate-name")).toBe(true);
  });

  it("flags cyclic type derivation", () => {
    const xml = `<?xml version="1.0"?>
      <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:tns="urn:example" targetNamespace="urn:example">
        <xs:complexType name="A">
          <xs:complexContent>
            <xs:extension base="tns:B"><xs:sequence/></xs:extension>
          </xs:complexContent>
        </xs:complexType>
        <xs:complexType name="B">
          <xs:complexContent>
            <xs:extension base="tns:A"><xs:sequence/></xs:extension>
          </xs:complexContent>
        </xs:complexType>
      </xs:schema>`;
    const { model } = loadSchemaFromString(xml, "f1", "cycle.xsd");
    const diagnostics = validateModel(model);
    expect(diagnostics.some((d) => d.code === "cyclic-derivation")).toBe(true);
  });

  it("flags an invalid facet pattern and an inverted min/max range", () => {
    const xml = `<?xml version="1.0"?>
      <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="urn:example">
        <xs:simpleType name="Bad">
          <xs:restriction base="xs:string">
            <xs:pattern value="["/>
            <xs:minLength value="10"/>
            <xs:maxLength value="2"/>
          </xs:restriction>
        </xs:simpleType>
      </xs:schema>`;
    const { model } = loadSchemaFromString(xml, "f1", "bad-facets.xsd");
    const diagnostics = validateModel(model);
    expect(diagnostics.some((d) => d.code === "invalid-pattern")).toBe(true);
    expect(diagnostics.some((d) => d.code === "invalid-length-range")).toBe(true);
  });

  it("flags an xs:all child with maxOccurs > 1", () => {
    const xml = `<?xml version="1.0"?>
      <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="urn:example">
        <xs:complexType name="Bad">
          <xs:all>
            <xs:element name="a" type="xs:string" maxOccurs="2"/>
          </xs:all>
        </xs:complexType>
      </xs:schema>`;
    const { model } = loadSchemaFromString(xml, "f1", "bad-all.xsd");
    const diagnostics = validateModel(model);
    expect(diagnostics.some((d) => d.code === "invalid-all-cardinality")).toBe(true);
  });
});
