import {
  ThreeMFDocument,
  MeshGeometry,
  MeshResource,
  Transform3D,
} from "../dist/index.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { unzipSync, strFromU8 } from "fflate";
import { read3mf, write3mf } from "../dist/opc/package.js";
import { createData3mf } from "./fixtures.mjs";
import { validateDocument } from "../dist/validate.js";
import {
  nextResourceId,
  translation,
} from "../dist/model/helpers.js";
import {
  triangleProperties,
  compositeWeights,
} from "../dist/model/properties.js";
import { NS, REL } from "../dist/index.js";
import { basic, tetrahedron, uuidFactory } from "./fixtures.mjs";

test("Core meshes, Unicode XML metadata, precision and deterministic ZIP round trip", () => {
  const doc = basic();
  doc.models[0].metadata = [
    { name: "Title", value: "한글 & < > \" '\n🙂", preserve: true },
    { name: "Application", value: "3mfiy" },
  ];
  doc.models[0].resources[1].mesh.positions[3] = 1.0000000000000002;
  const owned = ThreeMFDocument.fromData(doc);
  const mesh = owned.rootModel.requireResource(doc.models[0].resources[1].id);
  assert.ok(mesh instanceof MeshResource);
  const outside = owned.toData();
  outside.models[0].resources[1].mesh.positions[3] = 99;
  assert.equal(mesh.geometry.toData().positions[3], 1.0000000000000002);
  const clone = owned.clone();
  clone.rootModel.requireResource(mesh.id).setName("Independent clone");
  assert.notEqual(mesh.name, "Independent clone");
  const data = owned.write({ validation: { topology: true } });
  assert.deepEqual(data, owned.write());
  assert.ok(
    ThreeMFDocument.read(data).rootModel.requireResource(mesh.id) instanceof
      MeshResource,
  );
  const result = read3mf(data);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.document.models[0].metadata[0], {
    ...doc.models[0].metadata[0],
    type: undefined,
  });
  assert.equal(
    result.document.models[0].resources[1].mesh.positions[3],
    1.0000000000000002,
  );
  assert.equal(
    read3mf(write3mf(result.document)).document.models[0].resources[2].name,
    "Tetra & <test>",
  );
  const files = unzipSync(data);
  assert.ok(files["[Content_Types].xml"]);
  assert.ok(!strFromU8(files["3D/3dmodel.model"]).includes("Bambu"));
});
test("Production multiple model parts, UUIDs, component and build transforms", () => {
  const { document } = createData3mf(
    [
      {
        name: "assembly",
        transform: translation(9, 8, 7),
        parts: [{ mesh: tetrahedron(), transform: translation(1, 2, 3) }],
      },
    ],
    {
      rootPath: "/Models/root.model",
      meshPath: "/Models/Parts/mesh.model",
      uuid: uuidFactory(),
    },
  );
  const read = read3mf(write3mf(document)).document;
  assert.equal(read.root, "/Models/root.model");
  assert.equal(read.models.length, 2);
  const root = read.models.find((m) => m.path === read.root);
  assert.deepEqual(root.build[0].transform, translation(9, 8, 7));
  assert.ok(root.requiredExtensions.includes(NS.production));
  assert.ok(
    read.relationships.some(
      (r) =>
        r.source === "/Models/root.model" &&
        r.target === "/Models/Parts/mesh.model",
    ),
  );
  assert.deepEqual(
    ThreeMFDocument.fromData(document)
      .withProductionUUIDs(() => {
        throw Error("unexpected UUID generation");
      })
      .toData(),
    document,
  );
  const draft = ThreeMFDocument.fromData(basic());
  const before = draft.toData();
  let calls = 0;
  assert.throws(
    () =>
      draft.withProductionUUIDs(() => {
        if (++calls === 2) throw Error("factory failure");
        return "00000099-abcd-4abc-8abc-0123456789ab";
      }),
    /factory failure/,
  );
  assert.deepEqual(draft.toData(), before);
});
test("buffer adapter accepts Manifold strides, rejects lossy index conversion", () => {
  const mesh = MeshGeometry.fromBuffers(
    new Float32Array([1, 2, 3, 99, 4, 5, 6, 99]),
    [0, 1, 1],
    { stride: 4 },
  );
  assert.deepEqual(Array.from(mesh.toData().positions), [1, 2, 3, 4, 5, 6]);
  assert.throws(() => MeshGeometry.fromBuffers([1, 2, 3], [0], { stride: 2 }));
  const shared = new Float64Array(new SharedArrayBuffer(12 * 8));
  shared.set(tetrahedron().positions);
  const owned = new MeshGeometry(shared, tetrahedron().indices);
  shared[0] = 999;
  const snapshot = owned.toData();
  snapshot.positions[0] = 888;
  assert.equal(owned.toData().positions[0], 0);
  const doc = basic();
  doc.models[0].resources[1].mesh.indices = [0, -1, 2];
  assert.ok(validateDocument(doc).some((d) => d.code === "VERTEX_INDEX"));
});
test("transforms use spec row-vector order", () => {
  const rotation = [0, 1, 0, -1, 0, 0, 0, 0, 1, 0, 0, 0];
  assert.deepEqual(
    new Transform3D(rotation)
      .then(Transform3D.translation(5, 6, 7))
      .apply([1, 2, 3]),
    [3, 7, 10],
  );
  assert.equal(nextResourceId(basic().models[0]), 4);
  const source = tetrahedron();
  source.properties = [{ p1: 0, p3: 2 }, undefined, undefined, undefined];
  const mirrored = MeshGeometry.fromData(source)
    .transformed(new Transform3D([-1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]))
    .toData();
  const volume = ({ positions: p, indices: ix }) => {
    let sum = 0;
    for (let i = 0; i < ix.length; i += 3) {
      const a = ix[i] * 3,
        b = ix[i + 1] * 3,
        c = ix[i + 2] * 3;
      sum +=
        p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) -
        p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) +
        p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
    }
    return sum / 6;
  };
  assert.equal(volume(mirrored), volume(source));
  assert.equal(mirrored.properties[0].p2, 2);
  assert.equal(mirrored.properties[0].p3, undefined);
});
test("materials colors, textures, composites, multiproperties and corner inheritance", () => {
  const doc = basic(),
    m = doc.models[0];
  m.resources = [
    {
      kind: "baseMaterials",
      id: 1,
      bases: [
        { name: "A", displayColor: "#123456" },
        { name: "B", displayColor: "#987654FF" },
      ],
    },
    {
      kind: "colorGroup",
      id: 2,
      colors: ["#FF0000FF", "#00FF00FF", "#0000FFFF"],
    },
    {
      kind: "texture2d",
      id: 3,
      path: "/3D/Textures/a.png",
      contentType: "image/png",
      tileStyleU: "mirror",
      filter: "nearest",
    },
    {
      kind: "texture2dGroup",
      id: 4,
      textureId: 3,
      coordinates: [
        { u: 0, v: 0 },
        { u: 1, v: 0 },
        { u: 0, v: 1 },
      ],
    },
    {
      kind: "compositeMaterials",
      id: 5,
      materialId: 1,
      materialIndices: [0, 1],
      composites: [[0.25, 0.5], [0, 0], []],
    },
    {
      kind: "multiProperties",
      id: 6,
      propertyIds: [5, 2, 4],
      blendMethods: ["mix", "multiply"],
      properties: [[0, 1, 2], [1]],
    },
    {
      kind: "object",
      id: 7,
      mesh: {
        ...tetrahedron(),
        properties: [
          { pid: 2, p1: 0, p2: 1, p3: 2 },
          undefined,
          undefined,
          undefined,
        ],
      },
      property: { pid: 6, index: 0 },
    },
  ];
  m.build = [{ objectId: 7 }];
  doc.attachments = [
    {
      path: "/3D/Textures/a.png",
      contentType: "image/png",
      data: new Uint8Array([137, 80, 78, 71]),
    },
  ];
  const parsed = read3mf(write3mf(doc)).document,
    model = parsed.models[0],
    obj = model.resources.at(-1);
  assert.deepEqual(triangleProperties(model, obj, 0).indices, [0, 1, 2]);
  assert.equal(triangleProperties(model, obj, 1).resource.id, 6);
  assert.deepEqual(compositeWeights(model.resources[4], 0), [1 / 3, 2 / 3]);
  assert.deepEqual(compositeWeights(model.resources[4], 1), [0.5, 0.5]);
  assert.ok(parsed.relationships.some((r) => r.type === REL.texture));
  assert.equal(parsed.attachments[0].data[0], 137);
});
test("opaque attachments, external relationship and custom metadata survive edits", () => {
  const doc = basic();
  doc.models[0].namespaces = { vendor: "urn:vendor:metadata" };
  doc.models[0].metadata = [
    { name: "vendor:key", value: "keep", preserve: true },
  ];
  doc.attachments = [
    {
      path: "/Metadata/custom.bin",
      contentType: "application/octet-stream",
      data: new Uint8Array([0, 255, 10]),
    },
  ];
  doc.relationships = [
    { id: "keep", type: REL.mustPreserve, target: "/Metadata/custom.bin" },
    {
      id: "link",
      type: "urn:example:website",
      target: "https://example.test/",
      external: true,
    },
  ];
  const shared = new Uint8Array(new SharedArrayBuffer(3));
  shared.set([1, 2, 3]);
  const owned = ThreeMFDocument.fromData(doc);
  owned.replaceAttachment({ ...doc.attachments[0], data: shared });
  shared[0] = 99;
  const snapshot = owned.getAttachment(doc.attachments[0].path);
  snapshot.data[0] = 88;
  assert.equal(owned.getAttachment(doc.attachments[0].path).data[0], 1);
  const parsed = read3mf(write3mf(doc)).document;
  parsed.models[0].resources[2].name = "Edited";
  const reread = read3mf(write3mf(parsed)).document;
  assert.deepEqual(reread.attachments[0].data, doc.attachments[0].data);
  assert.equal(
    reread.relationships.find((r) => r.id === "link").external,
    true,
  );
  assert.equal(reread.models[0].metadata[0].name, "vendor:key");
});
test("validation reports duplicate IDs, cycles, missing references, invalid transforms", () => {
  const doc = basic(),
    m = doc.models[0];
  m.resources.push({ kind: "object", id: 3, components: [{ objectId: 3 }] });
  m.build[0].transform = Array(12).fill(0);
  const codes = new Set(validateDocument(doc).map((d) => d.code));
  for (const code of ["DUPLICATE_RESOURCE", "COMPONENT_CYCLE", "TRANSFORM"])
    assert.ok(codes.has(code), code);
  assert.throws(
    () => write3mf(doc),
    (e) => e.code === "VALIDATION" && e.diagnostics.length > 0,
  );
});
test("topology checks detect open or reversed faces without repairing the input", () => {
  const doc = basic(),
    mesh = doc.models[0].resources[1].mesh;
  mesh.indices = [0, 1, 2, 0, 1, 3, 0, 3, 2, 1, 2, 3];
  assert.ok(
    validateDocument(doc, { topology: true }).some(
      (d) => d.code === "MESH_TOPOLOGY",
    ),
  );
  assert.ok(!validateDocument(doc).some((d) => d.code === "MESH_TOPOLOGY"));
});
test("namespace prefix collisions do not change extension identity", () => {
  const doc = basic();
  doc.models[0].namespaces = { m: "urn:custom" };
  doc.models[0].resources.unshift({
    kind: "colorGroup",
    id: 10,
    colors: ["#ffffff"],
  });
  const parsed = read3mf(write3mf(doc)).document.models[0];
  assert.equal(parsed.namespaces.m, "urn:custom");
  assert.ok(parsed.requiredExtensions.includes(NS.materials));
});
