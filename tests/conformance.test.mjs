import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { zipSync, unzipSync, strToU8 } from "fflate";
import { read3mf, write3mf } from "../package/core/dist/opc/package.js";
import { basic } from "./fixtures.mjs";
test("reads independently authored Consortium metadata example and preserves object/item metadata", () => {
  const bytes = zipSync({
    "[Content_Types].xml": strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/></Types>',
    ),
    "_rels/.rels": strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="model" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" Target="3D/original.model"/></Relationships>',
    ),
    "3D/original.model": readFileSync(
      new URL("./fixtures/consortium-metadata.model", import.meta.url),
    ),
  });
  const parsed = read3mf(bytes, { validation: { topology: true } }).document;
  assert.equal(parsed.models[0].resources[1].mesh.positions.length, 24);
  assert.equal(parsed.models[0].resources[1].mesh.indices.length, 36);
  const again = read3mf(write3mf(parsed)).document;
  assert.equal(again.models[0].resources[1].metadata[0].preserve, true);
  assert.equal(again.models[0].build[0].metadata[0].value, "1");
});
test("generated Core XML validates against the official Core XSD", (t) => {
  const available = spawnSync("xmllint", ["--version"]);
  if (available.error?.code === "ENOENT") {
    t.skip("xmllint not installed; run npm test on a host with libxml2");
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "3mfiy-schema-"));
  try {
    const files = unzipSync(write3mf(basic()));
    const file = join(dir, "model.xml");
    writeFileSync(file, files["3D/3dmodel.model"]);
    const schema = join(dir, "core.xsd");
    writeFileSync(
      schema,
      readFileSync(
        new URL("./fixtures/core.xsd", import.meta.url),
        "utf8",
      ).replaceAll('maxOccurs="2147483647"', 'maxOccurs="unbounded"'),
    );
    writeFileSync(
      join(dir, "xml.xsd"),
      readFileSync(new URL("./fixtures/xml.xsd", import.meta.url)),
    );
    const result = spawnSync(
      "xmllint",
      ["--nonet", "--noout", "--schema", schema, file],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
