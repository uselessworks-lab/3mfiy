import { ThreeMFUnit } from "./enums.js";
import { DEFAULT_MODEL_PATH } from "../constants.js";
import { fail } from "../errors.js";
import type {
  Document,
  Mesh,
  Model,
  NumericArray,
  Transform,
} from "./types.js";
export const IDENTITY: Transform = Object.freeze([
  1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0,
]);
export function translation(x: number, y: number, z: number): Transform {
  return [1, 0, 0, 0, 1, 0, 0, 0, 1, x, y, z];
}
export function transformPoint(
  t: Transform,
  p: readonly [number, number, number],
): [number, number, number] {
  return [
    p[0] * t[0] + p[1] * t[3] + p[2] * t[6] + t[9],
    p[0] * t[1] + p[1] * t[4] + p[2] * t[7] + t[10],
    p[0] * t[2] + p[1] * t[5] + p[2] * t[8] + t[11],
  ];
}
/** Apply a first, then b (row-vector convention). */
export function multiplyTransforms(a: Transform, b: Transform): Transform {
  const out: number[] = [];
  for (let row = 0; row < 4; row++)
    for (let col = 0; col < 3; col++)
      out.push(
        a[row * 3]! * b[col]! +
          a[row * 3 + 1]! * b[3 + col]! +
          a[row * 3 + 2]! * b[6 + col]! +
          (row === 3 ? b[9 + col]! : 0),
      );
  return out as unknown as Transform;
}
export function createDocument(
  options: Partial<Pick<Model, "unit" | "language" | "metadata">> & {
    path?: string;
  } = {},
): Document {
  const { path = DEFAULT_MODEL_PATH, ...model } = options;
  return {
    root: path,
    models: [
      {
        path,
        unit: ThreeMFUnit.Millimeter,
        language: "und",
        ...model,
        resources: [],
        build: [],
      },
    ],
  };
}
export function nextResourceId(model: Model): number {
  const used = new Set(model.resources.map((r) => r.id));
  let id = 1;
  while (used.has(id)) id++;
  if (id >= 2147483648) fail("RESOURCE_ID", "No resource IDs available");
  return id;
}
/** Copies interleaved geometry such as Manifold vertProperties without rounding. */
export function meshFromBuffers(
  positions: NumericArray,
  indices: NumericArray,
  options: { stride?: number; offset?: number } = {},
): Mesh {
  const { stride = 3, offset = 0 } = options;
  if (
    !Number.isInteger(stride) ||
    stride < 3 ||
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset + 3 > stride ||
    positions.length % stride
  )
    fail("MESH_BUFFER", "Invalid vertex stride, offset or buffer length");
  const packed = new Float64Array((positions.length / stride) * 3);
  for (let i = 0; i < positions.length / stride; i++)
    for (let j = 0; j < 3; j++)
      packed[i * 3 + j] = positions[i * stride + offset + j]!;
  // Do not cast indices to Uint32 here: doing so would hide fractions/negative values before validation.
  return { positions: packed, indices: Array.from(indices) };
}
