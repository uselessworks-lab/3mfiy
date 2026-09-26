import { writeFile } from "node:fs/promises";
import {
  ThreeMFDocument,
  MeshGeometry,
  Transform3D,
} from "@uselessworks/3mfiy";
const mesh = new MeshGeometry(
  [0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 10],
  [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3],
);
const { document } = ThreeMFDocument.create3mf(
  [
    {
      name: "Example",
      transform: Transform3D.translation(20, 20, 0),
      parts: [{ name: "Tetrahedron", mesh, color: "#F08040" }],
    },
  ],
  { metadata: [{ name: "Application", value: "3mfiy example" }] },
);
await writeFile(
  process.argv[2] ?? "/tmp/3mfiy-example.3mf",
  document.write({ validation: { topology: true } }),
);
