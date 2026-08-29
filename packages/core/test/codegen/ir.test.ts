import { describe, expect, it } from "vitest";
import { loadSchemaFromString } from "../../src/parser/xsdLoader.js";
import { buildCodegenIr } from "../../src/codegen/ir.js";

const PERSON_XSD = `<?xml version="1.0"?>
  <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"
             xmlns:tns="urn:example:person"
             targetNamespace="urn:example:person"
             elementFormDefault="qualified">

    <xs:simpleType name="StatusType">
      <xs:restriction base="xs:string">
        <xs:enumeration value="ACTIVE"/>
        <xs:enumeration value="INACTIVE"/>
      </xs:restriction>
    </xs:simpleType>

    <xs:group name="ContactGroup">
      <xs:sequence>
        <xs:element name="email" type="xs:string" minOccurs="0"/>
      </xs:sequence>
    </xs:group>

    <xs:complexType name="AddressType">
      <xs:sequence>
        <xs:element name="street" type="xs:string"/>
      </xs:sequence>
    </xs:complexType>

    <xs:complexType name="PersonType">
      <xs:sequence>
        <xs:element name="firstName" type="xs:string"/>
        <xs:element name="status" type="tns:StatusType"/>
        <xs:choice minOccurs="0">
          <xs:element name="homeAddress" type="tns:AddressType"/>
          <xs:element name="workAddress" type="tns:AddressType"/>
        </xs:choice>
        <xs:group ref="tns:ContactGroup"/>
        <xs:element name="tag" type="xs:string" minOccurs="0" maxOccurs="unbounded"/>
      </xs:sequence>
      <xs:attribute name="id" type="xs:string" use="required"/>
    </xs:complexType>

    <xs:complexType name="EmployeeType">
      <xs:complexContent>
        <xs:extension base="tns:PersonType">
          <xs:sequence>
            <xs:element name="employeeId" type="xs:string"/>
          </xs:sequence>
        </xs:extension>
      </xs:complexContent>
    </xs:complexType>

    <xs:element name="Person" type="tns:PersonType"/>
    <xs:element name="Employee" type="tns:EmployeeType"/>
  </xs:schema>`;

describe("buildCodegenIr", () => {
  it("builds an enum from a named simpleType with an enumeration facet", () => {
    const { model } = loadSchemaFromString(PERSON_XSD, "f1", "person.xsd");
    const ir = buildCodegenIr(model);
    const statusEnum = ir.enums.find((e) => e.name === "StatusType");
    expect(statusEnum).toBeDefined();
    expect(statusEnum?.members.map((m) => m.literal)).toEqual(["ACTIVE", "INACTIVE"]);
  });

  it("flattens sequence/choice/group-ref particles into a single field list, propagating forced-optional from xs:choice and the group ref", () => {
    const { model } = loadSchemaFromString(PERSON_XSD, "f1", "person.xsd");
    const ir = buildCodegenIr(model);
    const person = ir.structs.find((s) => s.name === "PersonType");
    expect(person).toBeDefined();
    const byName = new Map(person!.fields.map((f) => [f.name, f]));

    expect(byName.get("firstName")?.optional).toBe(false);
    expect(byName.get("status")?.fieldType).toEqual({ kind: "enum", enumName: "StatusType" });

    // xs:choice branches are forced optional even though their own minOccurs defaults to 1
    expect(byName.get("homeAddress")?.optional).toBe(true);
    expect(byName.get("workAddress")?.optional).toBe(true);
    expect(byName.get("homeAddress")?.fieldType).toEqual({ kind: "struct", structName: "AddressType" });

    // group ref content is inlined
    expect(byName.get("email")?.optional).toBe(true);

    // unbounded element becomes a repeated field
    expect(byName.get("tag")?.repeated).toBe(true);

    // required attribute becomes a non-optional field
    expect(byName.get("id")?.isAttribute).toBe(true);
    expect(byName.get("id")?.optional).toBe(false);
  });

  it("does not inherit base fields into the derived struct's own field list (extension keeps its own particles only)", () => {
    const { model } = loadSchemaFromString(PERSON_XSD, "f1", "person.xsd");
    const ir = buildCodegenIr(model);
    const employee = ir.structs.find((s) => s.name === "EmployeeType");
    expect(employee?.baseStructName).toBe("PersonType");
    expect(employee?.fields.map((f) => f.name)).toEqual(["employeeId"]);
  });

  it("only emits root elements whose type resolves to a modeled struct", () => {
    const { model } = loadSchemaFromString(PERSON_XSD, "f1", "person.xsd");
    const ir = buildCodegenIr(model);
    expect(ir.rootElements).toEqual(
      expect.arrayContaining([
        { name: "Person", structName: "PersonType" },
        { name: "Employee", structName: "EmployeeType" }
      ])
    );
  });

  it("synthesizes an anonymous struct/enum for inline (unnamed) types", () => {
    const xml = `<?xml version="1.0"?>
      <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="urn:example">
        <xs:complexType name="Widget">
          <xs:sequence>
            <xs:element name="color">
              <xs:simpleType>
                <xs:restriction base="xs:string">
                  <xs:enumeration value="RED"/>
                  <xs:enumeration value="BLUE"/>
                </xs:restriction>
              </xs:simpleType>
            </xs:element>
            <xs:element name="detail">
              <xs:complexType>
                <xs:sequence>
                  <xs:element name="note" type="xs:string"/>
                </xs:sequence>
              </xs:complexType>
            </xs:element>
          </xs:sequence>
        </xs:complexType>
      </xs:schema>`;
    const { model } = loadSchemaFromString(xml, "f1", "widget.xsd");
    const ir = buildCodegenIr(model);
    const widget = ir.structs.find((s) => s.name === "Widget");
    const colorField = widget?.fields.find((f) => f.name === "color");
    const detailField = widget?.fields.find((f) => f.name === "detail");
    expect(colorField?.fieldType.kind).toBe("enum");
    expect(detailField?.fieldType.kind).toBe("struct");
    if (detailField?.fieldType.kind === "struct") {
      const detailStruct = ir.structs.find((s) => s.name === (detailField.fieldType as { structName: string }).structName);
      expect(detailStruct).toBeDefined();
    }
  });

  it("maps a reference to a xs:list simpleType to a repeated field of the item type, with no warning", () => {
    const xml = `<?xml version="1.0"?>
      <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"
                 xmlns:tns="urn:example"
                 targetNamespace="urn:example">
        <xs:simpleType name="Tags">
          <xs:list itemType="xs:string"/>
        </xs:simpleType>
        <xs:complexType name="Doc">
          <xs:sequence>
            <xs:element name="tags" type="tns:Tags"/>
          </xs:sequence>
        </xs:complexType>
      </xs:schema>`;
    const { model } = loadSchemaFromString(xml, "f1", "doc.xsd");
    const ir = buildCodegenIr(model);
    const doc = ir.structs.find((s) => s.name === "Doc");
    const tagsField = doc?.fields.find((f) => f.name === "tags");
    expect(tagsField?.fieldType).toEqual({ kind: "primitive", primitive: "string" });
    expect(tagsField?.repeated).toBe(true);
    expect(ir.warnings).toEqual([]);
  });

  it("warns and falls back to string for a xs:union simpleType (member types not distinguished)", () => {
    const xml = `<?xml version="1.0"?>
      <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"
                 xmlns:tns="urn:example"
                 targetNamespace="urn:example">
        <xs:simpleType name="IntOrString">
          <xs:union memberTypes="xs:int xs:string"/>
        </xs:simpleType>
        <xs:complexType name="Doc">
          <xs:sequence>
            <xs:element name="value" type="tns:IntOrString"/>
          </xs:sequence>
        </xs:complexType>
      </xs:schema>`;
    const { model } = loadSchemaFromString(xml, "f1", "doc.xsd");
    const ir = buildCodegenIr(model);
    const doc = ir.structs.find((s) => s.name === "Doc");
    const valueField = doc?.fields.find((f) => f.name === "value");
    expect(valueField?.fieldType).toEqual({ kind: "primitive", primitive: "string" });
    expect(valueField?.repeated).toBe(false);
    expect(ir.warnings.some((w) => w.message.includes("union"))).toBe(true);
  });

  it("warns when a complexType has mixed content, and skips xs:any wildcard particles as fields", () => {
    const xml = `<?xml version="1.0"?>
      <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="urn:example">
        <xs:complexType name="Mixed" mixed="true">
          <xs:sequence>
            <xs:element name="note" type="xs:string"/>
            <xs:any namespace="##other" processContents="lax" minOccurs="0"/>
          </xs:sequence>
        </xs:complexType>
      </xs:schema>`;
    const { model } = loadSchemaFromString(xml, "f1", "mixed.xsd");
    const ir = buildCodegenIr(model);
    const mixed = ir.structs.find((s) => s.name === "Mixed");
    expect(mixed?.fields.map((f) => f.name)).toEqual(["note"]);
    expect(ir.warnings.some((w) => w.message.includes("mixed content"))).toBe(true);
    expect(ir.warnings.some((w) => w.message.includes("xs:any"))).toBe(true);
  });

  it("handles a self-referencing (recursive) complexType without infinite recursion", () => {
    const xml = `<?xml version="1.0"?>
      <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"
                 xmlns:tns="urn:example"
                 targetNamespace="urn:example">
        <xs:complexType name="TreeNode">
          <xs:sequence>
            <xs:element name="value" type="xs:string"/>
            <xs:element name="child" type="tns:TreeNode" minOccurs="0" maxOccurs="unbounded"/>
          </xs:sequence>
        </xs:complexType>
      </xs:schema>`;
    const { model } = loadSchemaFromString(xml, "f1", "tree.xsd");
    const ir = buildCodegenIr(model);
    const node = ir.structs.find((s) => s.name === "TreeNode");
    const child = node?.fields.find((f) => f.name === "child");
    expect(child?.fieldType).toEqual({ kind: "struct", structName: "TreeNode" });
    expect(child?.repeated).toBe(true);
  });
});
