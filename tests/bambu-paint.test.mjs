import test from "node:test";
import assert from "node:assert/strict";
import {
  MeshGeometry,
  ThreeMFDocument,
  Transform3D,
} from "../package/core/dist/index.js";
import {
  BambuFacetPainting,
  BambuProfile,
  BambuStudioProject,
} from "../package/core/dist/adapters/bambu.js";
import {
  readBambuPaint,
  writeBambuPaint,
} from "../package/core/dist/xml/bambu-paint.js";
const triangle = new MeshGeometry(
  [0, 0, 0, 4, 0, 0, 0, 4, 0, 0, 0, 4],
  [0, 2, 1, 0, 1, 3, 1, 2, 3, 2, 0, 3],
);
test("recursive painting follows Bambu child and nibble order with inherited leaves", () => {
  const tree = { split: 1, side: 0, children: [1, 2] };
  assert.equal(writeBambuPaint(tree), "481");
  assert.deepEqual(readBambuPaint("481"), tree);
  const mixed = { split: 3, side: 0, children: [1, 2, 3, undefined] };
  assert.equal(writeBambuPaint(mixed), "480C03");
  assert.deepEqual(readBambuPaint("480C03"), mixed);
  for (const slot of [1, 2, 3, 18, 255])
    assert.equal(readBambuPaint(writeBambuPaint(slot)), slot);
  assert.throws(() => readBambuPaint("3"));
  assert.throws(() => readBambuPaint("4481"));
  assert.throws(() => readBambuPaint("F"));
  assert.throws(() => writeBambuPaint({ split: 1, side: 3, children: [1, 2] }));
});
test("sampled painting round-trips without adding vertices or triangles and owns its forest", () => {
  const before = triangle.toData(),
    paint = BambuFacetPainting.sample(
      triangle,
      (point) => (point[0] < 2 ? 1 : 2),
      { maxEdgeLength: 0.5 },
    ),
    mesh = triangle.withBambuTrianglePaint(paint);
  assert.deepEqual(mesh.toData().positions, before.positions);
  assert.deepEqual(mesh.toData().indices, before.indices);
  assert.equal(mesh.vertexCount, 4);
  assert.equal(mesh.triangleCount, 4);
  BambuFacetPainting.visit(mesh, paint, (points, slot) => {
    const x = points.reduce((sum, p) => sum + p[0] / 3, 0);
    assert.equal(slot, x < 2 ? 1 : 2);
  });
  const { document } = ThreeMFDocument.create3mf([{ parts: [{ mesh }] }]);
  const read = ThreeMFDocument.read(document.write());
  const result = read
    .toData()
    .models[0].resources.find((r) => r.kind === "object" && r.mesh).mesh;
  assert.deepEqual(
    paint.map(
      (_, i) =>
        result.bambuTrianglePaint?.[i] ?? result.bambuTriangleColors?.[i],
    ),
    paint,
  );
  assert.equal(result.positions.length, 12);
  assert.equal(result.indices.length, 12);
  assert.deepEqual(
    mesh.transformed(Transform3D.translation(1, 0, 0)).toData()
      .bambuTrianglePaint,
    paint,
  );
  const snapshot = mesh.toData();
  snapshot.bambuTrianglePaint[0].children[0] = 255;
  assert.deepEqual(mesh.toData().bambuTrianglePaint, paint);
});
test("paint budgets, conflicting assignments and nested missing filament slots are rejected", () => {
  assert.throws(() =>
    BambuFacetPainting.sample(triangle, () => 1, {
      maxEdgeLength: 0.001,
      maxNodes: 5,
    }),
  );
  const tree = { split: 1, side: 0, children: [1, 3] };
  const { document } = ThreeMFDocument.create3mf([
    {
      parts: [
        {
          mesh: triangle.withBambuTrianglePaint([
            tree,
            undefined,
            undefined,
            undefined,
          ]),
        },
      ],
    },
  ]);
  const project = new BambuStudioProject(document, {
    applicationVersion: "2.0",
    profile: BambuProfile.fromFilaments([
      { settingsId: "PLA", color: "#FFFFFF" },
    ]),
  });
  assert.throws(() => project.write());
  assert.throws(() =>
    ThreeMFDocument.create3mf([
      {
        parts: [
          {
            mesh: triangle
              .withBambuTriangleColors([1, undefined, undefined, undefined])
              .withBambuTrianglePaint([tree, undefined, undefined, undefined]),
          },
        ],
      },
    ]),
  );
});
