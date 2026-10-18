import {
  ThreeMFDocument,
  MeshGeometry,
  Transform3D,
} from "../dist/index.js";
export const tetrahedron = () => ({
  positions: new Float64Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]),
  indices: new Uint32Array([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]),
});
export const basic = () =>
  createData3mf([
    {
      name: "Tetra & <test>",
      parts: [{ mesh: tetrahedron(), color: "#123456" }],
    },
  ]).document;
export const uuidFactory = () => {
  let n = 1;
  return () =>
    `${(n++).toString(16).padStart(8, "0")}-abcd-4abc-8abc-0123456789ab`;
};

// Plain-data fixtures exercise malformed serializer input independently of the authoring API.
export function createData3mf(objects, options) {
  const result = ThreeMFDocument.create3mf(
    objects.map((object) => ({
      ...object,
      transform: object.transform
        ? new Transform3D(object.transform)
        : undefined,
      parts: object.parts.map((part) => ({
        ...part,
        mesh: MeshGeometry.fromData(part.mesh),
        transform: part.transform ? new Transform3D(part.transform) : undefined,
      })),
    })),
    options,
  );
  return { document: result.document.toData(), objects: result.objects };
}
