import { test } from "node:test";
import assert from "node:assert/strict";
import { unzipSync, zipSync, strToU8, strFromU8 } from "fflate";
import { read3mf, write3mf } from "../package/core/dist/opc/package.js";
import { NS } from "../package/core/dist/index.js";
import { validateDocument } from "../package/core/dist/validate.js";
import { basic } from "./fixtures.mjs";
const rewrite = (fn) => {
  const files = unzipSync(write3mf(basic()));
  fn(files);
  return zipSync(files);
};
const editModel = (fn) =>
  rewrite(
    (f) =>
      (f["3D/3dmodel.model"] = strToU8(fn(strFromU8(f["3D/3dmodel.model"])))),
  );
test("alternate namespace prefixes and relative root targets are accepted", () => {
  const data = rewrite((f) => {
    f["_rels/.rels"] = strToU8(
      strFromU8(f["_rels/.rels"]).replace('Target="/3D/', 'Target="3D/'),
    );
    const xml = strFromU8(f["3D/3dmodel.model"]);
    f["3D/3dmodel.model"] = strToU8(
      xml
        .replace("xmlns=", "xmlns:c=")
        .replace(
          /<(\/?)(model|resources|basematerials|base|object|mesh|vertices|vertex|triangles|triangle|components|component|build|item)(?=[\s/>])/g,
          "<$1c:$2",
        ),
    );
  });
  assert.equal(read3mf(data).document.models.length, 1);
});
test("unsupported required extensions fail by URI; optional unknown markup is never dropped", () => {
  assert.throws(
    () =>
      read3mf(
        editModel((xml) =>
          xml.replace(
            "<model ",
            '<model xmlns:q="urn:unknown" requiredextensions="q" ',
          ),
        ),
      ),
    (e) => e.code === "UNSUPPORTED_EXTENSION",
  );
  assert.throws(
    () =>
      read3mf(
        editModel((xml) => xml.replace("<resources>", "<resources><custom/>")),
      ),
    (e) => e.code === "UNSUPPORTED_MARKUP",
  );
  assert.throws(
    () =>
      read3mf(
        editModel((xml) =>
          xml.replace("<mesh>", '<mesh xmlns:q="urn:vendor" q:data="1">'),
        ),
      ),
    (e) => e.code === "UNSUPPORTED_MARKUP",
  );
});
test("DTD, malformed XML, namespaces and numeric coercion are rejected", () => {
  for (const mutate of [
    (xml) =>
      xml.replace("<model", '<!DOCTYPE model [<!ENTITY x "expanded">]><model'),
    (xml) => xml.replace('x="0"', 'x="NaN"'),
    (xml) => xml.replace('x="0"', 'x="0xFF"'),
    (xml) => xml.replace("</model>", ""),
    (xml) => xml.replace(NS.core, "urn:not-core"),
  ])
    assert.throws(() => read3mf(editModel(mutate)));
});
test("ZIP limits reject before extracting entries; corrupted CRCs fail", () => {
  const bytes = write3mf(basic());
  assert.throws(
    () => read3mf(bytes, { limits: { maxArchiveBytes: 10 } }),
    (e) => e.code === "ZIP_LIMIT",
  );
  assert.throws(
    () => read3mf(bytes, { limits: { maxTotalBytes: 10 } }),
    (e) => e.code === "ZIP_LIMIT",
  );
  assert.throws(
    () => read3mf(bytes, { limits: { maxEntries: 1 } }),
    (e) => e.code === "ZIP_LIMIT",
  );
  const copy = bytes.slice(),
    view = new DataView(copy.buffer);
  let p = 0;
  for (; p < copy.length - 4; p++)
    if (view.getUint32(p, true) === 0x02014b50) break;
  copy[p + 16] ^= 1;
  assert.throws(
    () => read3mf(copy),
    (e) => e.code === "ZIP_INTEGRITY",
  );
});
test("ZIP path traversal, aliases and missing content types are rejected", () => {
  for (const name of [
    "../escape",
    "/absolute",
    "3D/%2e%2e/escape",
    "3D/%2Fescape",
    "3d/3dmodel.model",
  ])
    assert.throws(() =>
      read3mf(rewrite((files) => (files[name] = strToU8("bad")))),
    );
  assert.throws(
    () => read3mf(rewrite((f) => delete f["[Content_Types].xml"])),
    (e) => e.code === "CONTENT_TYPES",
  );
  assert.throws(
    () =>
      read3mf(
        rewrite(
          (f) =>
            (f["_rels/.rels"] = strToU8(
              strFromU8(f["_rels/.rels"]).replace(
                "/3D/3dmodel.model",
                "../../outside.model",
              ),
            )),
        ),
      ),
    (e) => e.code === "PART_PATH",
  );
});
test("XML complexity limits are enforced", () => {
  assert.throws(
    () => read3mf(write3mf(basic()), { limits: { maxXmlDepth: 2 } }),
    (e) => e.code === "XML_LIMIT",
  );
  assert.throws(
    () => read3mf(write3mf(basic()), { limits: { maxXmlNodes: 3 } }),
    (e) => e.code === "XML_LIMIT",
  );
});
test("validation rejects bad properties, metadata namespace, path and unsupported required extension", () => {
  const doc = basic();
  doc.models[0].resources[1].property.index = 99;
  doc.models[0].metadata = [{ name: "unknown:key", value: "x" }];
  doc.models[0].requiredExtensions = ["urn:no"];
  const codes = validateDocument(doc).map((d) => d.code);
  for (const code of [
    "PROPERTY_INDEX",
    "METADATA_NAME",
    "UNSUPPORTED_EXTENSION",
  ])
    assert.ok(codes.includes(code));
});
test("duplicate XML containers and unexpected content fail explicitly", () => {
  assert.throws(
    () =>
      read3mf(
        editModel((xml) =>
          xml.replace("</resources>", "</resources><resources/>"),
        ),
      ),
    (e) => e.code === "XML_STRUCTURE",
  );
  assert.throws(
    () => read3mf(editModel((xml) => xml.replace("<mesh>", "<mesh>garbage"))),
    (e) => e.code === "XML_CONTENT",
  );
});
