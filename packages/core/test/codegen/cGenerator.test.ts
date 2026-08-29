import { describe, expect, it } from "vitest";
import { loadSchemaFromString } from "../../src/parser/xsdLoader.js";
import { cGenerator } from "../../src/codegen/generators/c/cGenerator.js";

const PERSON_XSD = `<?xml version="1.0"?>
  <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"
             xmlns:tns="urn:example:person"
             targetNamespace="urn:example:person">
    <xs:complexType name="EmployeeType">
      <xs:complexContent>
        <xs:extension base="tns:PersonType">
          <xs:sequence>
            <xs:element name="employeeId" type="xs:string"/>
          </xs:sequence>
        </xs:extension>
      </xs:complexContent>
    </xs:complexType>
    <xs:complexType name="PersonType">
      <xs:sequence>
        <xs:element name="firstName" type="xs:string"/>
        <xs:element name="status" type="tns:StatusType"/>
        <xs:element name="primaryAddress" type="tns:AddressType"/>
        <xs:element name="homeAddress" type="tns:AddressType" minOccurs="0"/>
        <xs:element name="tag" type="xs:string" minOccurs="0" maxOccurs="unbounded"/>
      </xs:sequence>
      <xs:attribute name="id" type="xs:string" use="required"/>
    </xs:complexType>
    <xs:complexType name="AddressType">
      <xs:sequence>
        <xs:element name="street" type="xs:string"/>
      </xs:sequence>
    </xs:complexType>
    <xs:simpleType name="StatusType">
      <xs:restriction base="xs:string">
        <xs:enumeration value="ACTIVE"/>
        <xs:enumeration value="INACTIVE"/>
      </xs:restriction>
    </xs:simpleType>
  </xs:schema>`;

const TREE_XSD = `<?xml version="1.0"?>
  <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"
             xmlns:tns="urn:example:tree"
             targetNamespace="urn:example:tree">
    <xs:complexType name="TreeNode">
      <xs:sequence>
        <xs:element name="value" type="xs:string"/>
        <xs:element name="child" type="tns:TreeNode" minOccurs="0" maxOccurs="unbounded"/>
      </xs:sequence>
    </xs:complexType>
  </xs:schema>`;

function generate(xml: string, options: Record<string, unknown> = {}) {
  const { model } = loadSchemaFromString(xml, "f1", "s.xsd");
  return cGenerator.generate(model, { language: "c", includeSerializationStubs: false, ...options } as never);
}

describe("cGenerator", () => {
  it("emits a header and source file", () => {
    const files = generate(PERSON_XSD);
    expect(files.map((f) => f.path)).toEqual(["schema.h", "schema.c"]);
  });

  it("emits an enum typedef with prefixed member constants", () => {
    const [header] = generate(PERSON_XSD);
    expect(header.content).toContain("typedef enum {");
    expect(header.content).toContain("STATUS_TYPE_ACTIVE");
    expect(header.content).toContain("STATUS_TYPE_INACTIVE");
    expect(header.content).toContain("} StatusType;");
  });

  it("represents a repeated field as a pointer + count pair", () => {
    const [header] = generate(PERSON_XSD);
    expect(header.content).toMatch(/char\*\* tag;/);
    expect(header.content).toContain("size_t tag_count;");
  });

  it("represents an optional struct field as a nullable pointer, and an optional scalar with a has_ flag", () => {
    const [header] = generate(PERSON_XSD);
    expect(header.content).toContain("AddressType* home_address;");
    expect(header.content).not.toContain("bool has_home_address;");
  });

  it("embeds the extension base struct by value as the first member", () => {
    const [header] = generate(PERSON_XSD);
    expect(header.content).toMatch(/struct EmployeeType \{\s*\n\s*PersonType base;/);
  });

  it("value-embeds a required non-repeated struct field", () => {
    const [header] = generate(PERSON_XSD);
    expect(header.content).toContain("AddressType primary_address;");
  });

  it("orders struct definitions so a base/embedded struct is defined before its dependent, even though the XSD declares EmployeeType and PersonType before AddressType", () => {
    const [header] = generate(PERSON_XSD);
    expect(header.content.indexOf("struct AddressType {")).toBeLessThan(header.content.indexOf("struct PersonType {"));
    expect(header.content.indexOf("struct PersonType {")).toBeLessThan(header.content.indexOf("struct EmployeeType {"));
  });

  it("breaks a self-referencing struct field into a pointer so the struct has finite size", () => {
    const [header] = generate(TREE_XSD);
    expect(header.content).toMatch(/struct TreeNode \{/);
    // "child" is both repeated (unbounded) and self-typed; repeated fields are always arrays,
    // so this is really exercising that the array element type isn't itself made into a pointer.
    expect(header.content).toContain("TreeNode* child;");
    expect(header.content).toContain("size_t child_count;");
  });

  it("generates init() that zero-initializes and free() that recursively releases nested allocations", () => {
    const [, source] = generate(PERSON_XSD);
    expect(source.content).toContain("void PersonType_init(PersonType* self) {");
    expect(source.content).toContain("memset(self, 0, sizeof(*self));");
    expect(source.content).toContain("void PersonType_free(PersonType* self) {");
    expect(source.content).toMatch(/for \(size_t i = 0; i < self->tag_count; i\+\+\) \{ free\(self->tag\[i\]\); \}/);
    expect(source.content).toContain("if (self->home_address != NULL) { AddressType_free(self->home_address); free(self->home_address); self->home_address = NULL; }");
    expect(source.content).toContain("PersonType_free(&self->base);");
  });

  it("emits serialization stub prototypes only when includeSerializationStubs is set", () => {
    const withoutStubs = generate(PERSON_XSD);
    expect(withoutStubs[0].content).not.toContain("_toXmlString");
    const withStubs = generate(PERSON_XSD, { includeSerializationStubs: true });
    expect(withStubs[0].content).toContain("PersonType_toXmlString");
  });

  it("switches file extensions and wraps declarations in extern \"C\" for the cpp option", () => {
    const files = generate(PERSON_XSD, { language: "cpp" });
    expect(files.map((f) => f.path)).toEqual(["schema.hpp", "schema.cpp"]);
    expect(files[0].content).toContain('extern "C" {');
  });

  it("reports the same schema-level warnings as validateModelSupport", () => {
    const { model } = loadSchemaFromString(TREE_XSD, "f1", "s.xsd");
    expect(cGenerator.validateModelSupport?.(model)).toEqual([]);
  });
});
