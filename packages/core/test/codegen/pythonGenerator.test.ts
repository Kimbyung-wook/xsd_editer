import { describe, expect, it } from "vitest";
import { loadSchemaFromString } from "../../src/parser/xsdLoader.js";
import { pythonGenerator } from "../../src/codegen/generators/python/pythonGenerator.js";

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

function generate(xml: string, options: Record<string, unknown> = {}) {
  const { model } = loadSchemaFromString(xml, "f1", "s.xsd");
  return pythonGenerator.generate(model, { style: "dataclass", ...options } as never);
}

describe("pythonGenerator", () => {
  it("emits a single schema.py file", () => {
    const files = generate(PERSON_XSD);
    expect(files.map((f) => f.path)).toEqual(["schema.py"]);
  });

  it("emits a str Enum for an enumeration facet", () => {
    const [file] = generate(PERSON_XSD);
    expect(file.content).toContain("class StatusType(str, Enum):");
    expect(file.content).toContain('ACTIVE = "ACTIVE"');
    expect(file.content).toContain('INACTIVE = "INACTIVE"');
  });

  it("emits a @dataclass per named complexType with real class inheritance for extension", () => {
    const [file] = generate(PERSON_XSD);
    expect(file.content).toContain("class PersonType:");
    expect(file.content).toContain("class EmployeeType(PersonType):");
    // base must be defined textually before the subclass references it
    expect(file.content.indexOf("class PersonType")).toBeLessThan(file.content.indexOf("class EmployeeType"));
  });

  it("makes every field Optional-with-default so multi-level inheritance never raises a field-ordering error", () => {
    const [file] = generate(PERSON_XSD);
    expect(file.content).toContain("first_name: Optional[str] = None");
    expect(file.content).toContain("tag: List[str] = field(default_factory=list)");
    expect(file.content).toContain("id: Optional[str] = None  # required");
  });

  it("uses Pydantic BaseModel + Field when style=pydantic", () => {
    const [file] = generate(PERSON_XSD, { style: "pydantic" });
    expect(file.content).toContain("from pydantic import BaseModel, Field");
    expect(file.content).toContain("class PersonType(BaseModel):");
    expect(file.content).toContain("class EmployeeType(PersonType):");
    expect(file.content).toContain("tag: List[str] = Field(default_factory=list)");
  });
});
