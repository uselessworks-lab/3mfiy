import { test } from "node:test";
import assert from "node:assert/strict";
import { strToU8 } from "fflate";
import { basic, uuidFactory } from "./fixtures.mjs";
import { read3mf, write3mf } from "../package/core/dist/opc/package.js";
import { validateDocument } from "../package/core/dist/validate.js";
import { withProductionUUIDs } from "../package/core/dist/extensions/production.js";
import { REL } from "../package/core/dist/index.js";
test("explicit relationship IDs survive semantic duplicates used by opaque XML", () => {
  const doc = basic();
  doc.attachments = [
    {
      path: "/Metadata/a.xml",
      contentType: "application/xml",
      data: strToU8('<x id="second"/>'),
    },
    {
      path: "/Metadata/b.bin",
      contentType: "application/octet-stream",
      data: new Uint8Array([1]),
    },
  ];
  doc.relationships = ["first", "second"].map((id) => ({
    source: "/Metadata/a.xml",
    type: "urn:custom:link",
    target: "/Metadata/b.bin",
    id,
  }));
  const parsed = read3mf(write3mf(doc)).document;
  assert.deepEqual(
    parsed.relationships
      .filter((r) => r.type === "urn:custom:link")
      .map((r) => r.id),
    ["first", "second"],
  );
});
test("validation reports OPC failures before write, including reserved models/signatures/MIME", () => {
  const missing = basic();
  missing.relationships = [{ type: REL.mustPreserve, target: "/missing.bin" }];
  assert.ok(
    validateDocument(missing).some((d) => d.code === "RELATIONSHIP_TARGET"),
  );
  for (const path of [
    "/[Content_Types].xml",
    "/3D/fake.rels",
    "/3D/_rels/model.xml",
  ]) {
    const doc = basic();
    doc.root = doc.models[0].path = path;
    assert.ok(validateDocument(doc).some((d) => d.code === "RESERVED_PART"));
    assert.throws(() => write3mf(doc));
  }
  const signed = basic();
  signed.relationships = [
    {
      type: "http://schemas.openxmlformats.org/package/2006/relationships/digital-signature/origin",
      target: "/Metadata/signature.bin",
    },
  ];
  signed.attachments = [
    {
      path: "/Metadata/signature.bin",
      contentType: "application/octet-stream",
      data: new Uint8Array([0]),
    },
  ];
  assert.ok(
    validateDocument(signed).some((d) => d.code === "UNSUPPORTED_SIGNATURE"),
  );
  const image = basic();
  image.models[0].resources[1].thumbnail = "/Metadata/plain.txt";
  image.attachments = [
    {
      path: "/Metadata/plain.txt",
      contentType: "text/plain",
      data: strToU8("not an image"),
    },
  ];
  assert.ok(
    validateDocument(image).some((d) => d.code === "IMAGE_CONTENT_TYPE"),
  );
});
test("every material resource reference must follow its declaration", () => {
  const doc = basic(),
    m = doc.models[0];
  [m.resources[0], m.resources[1]] = [m.resources[1], m.resources[0]];
  assert.ok(validateDocument(doc).some((d) => d.code === "RESOURCE_ORDER"));
  for (const r of [
    {
      kind: "texture2dGroup",
      id: 10,
      textureId: 11,
      coordinates: [{ u: 0, v: 0 }],
    },
    {
      kind: "compositeMaterials",
      id: 10,
      materialId: 11,
      materialIndices: [0, 1],
      composites: [[1, 0]],
    },
    { kind: "multiProperties", id: 10, propertyIds: [11], properties: [[0]] },
  ]) {
    const d = basic();
    d.models[0].resources.unshift(r);
    assert.ok(validateDocument(d).some((v) => v.code === "RESOURCE_ORDER"));
  }
});
test("Production root and relationship source use case-insensitive OPC identity", () => {
  const doc = basic();
  doc.root = doc.root.toUpperCase();
  const production = withProductionUUIDs(doc, uuidFactory());
  assert.deepEqual(validateDocument(production), []);
  assert.ok(production.models[0].buildUuid);
  production.attachments = [
    {
      path: "/Metadata/preview.png",
      contentType: "image/png",
      data: new Uint8Array([137, 80, 78, 71]),
    },
  ];
  production.models[0].resources[1].thumbnail = "/Metadata/preview.png";
  production.relationships = [
    {
      source: production.root,
      type: REL.thumbnail,
      target: "/METADATA/PREVIEW.PNG",
      id: "preview",
    },
  ];
  const parsed = read3mf(write3mf(production)).document;
  assert.equal(
    parsed.relationships.filter((r) => r.type === REL.thumbnail).length,
    1,
  );
});
test("empty extension attributes cannot produce undeclared prefixes", () => {
  const doc = basic();
  doc.models[0].resources[1].uuid = "";
  assert.ok(validateDocument(doc).some((d) => d.code === "UUID"));
  assert.throws(() => write3mf(doc));
});
