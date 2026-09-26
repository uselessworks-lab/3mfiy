import { DataSnapshot } from "./snapshot.js";
import { fail } from "../errors.js";
import {
  IDENTITY,
  meshFromBuffers,
  multiplyTransforms,
  transformPoint,
  translation,
} from "../model/helpers.js";
import type { Mesh, NumericArray, Transform } from "../model/types.js";

/** Immutable row-vector transform. Instances own their values. */
export class Transform3D {
  readonly #values: Transform;
  constructor(values: Transform = IDENTITY) {
    if (values.length !== 12 || values.some((v) => !Number.isFinite(v)))
      fail("TRANSFORM", "Transform requires twelve finite numbers");
    this.#values = [...values];
    if (this.determinant === 0 || !Number.isFinite(this.determinant))
      fail("TRANSFORM", "Transform must be invertible");
  }
  get determinant(): number {
    const t = this.#values;
    return (
      t[0] * (t[4] * t[8] - t[5] * t[7]) -
      t[1] * (t[3] * t[8] - t[5] * t[6]) +
      t[2] * (t[3] * t[7] - t[4] * t[6])
    );
  }
  static identity(): Transform3D {
    return new Transform3D();
  }
  static translation(x: number, y: number, z: number): Transform3D {
    return new Transform3D(translation(x, y, z));
  }
  then(next: Transform3D): Transform3D {
    return new Transform3D(multiplyTransforms(this.#values, next.#values));
  }
  apply(point: readonly [number, number, number]): [number, number, number] {
    return transformPoint(this.#values, point);
  }
  toData(): Transform {
    return [...this.#values];
  }
}

/** Immutable geometry value. Input, output and typed-array buffers are copied. */
export class MeshGeometry {
  readonly #data: Mesh;
  constructor(
    positions: NumericArray,
    indices: NumericArray,
    properties?: Mesh["properties"],
  ) {
    // Keep numeric precision and invalid indices intact for the document validator.
    this.#data = DataSnapshot.copy({ positions, indices, properties });
  }
  static fromData(data: Mesh): MeshGeometry {
    return new MeshGeometry(data.positions, data.indices, data.properties);
  }
  static fromBuffers(
    positions: NumericArray,
    indices: NumericArray,
    options: { stride?: number; offset?: number } = {},
  ): MeshGeometry {
    return MeshGeometry.fromData(meshFromBuffers(positions, indices, options));
  }
  get vertexCount(): number {
    return this.#data.positions.length / 3;
  }
  get triangleCount(): number {
    return this.#data.indices.length / 3;
  }
  transformed(transform: Transform3D): MeshGeometry {
    if (this.#data.positions.length % 3 || this.#data.indices.length % 3)
      fail("MESH_LENGTH", "Incomplete vertex or triangle triples");
    const positions = new Float64Array(this.#data.positions.length);
    for (let i = 0; i < positions.length; i += 3)
      positions.set(
        transform.apply([
          this.#data.positions[i]!,
          this.#data.positions[i + 1]!,
          this.#data.positions[i + 2]!,
        ]),
        i,
      );
    if (transform.determinant < 0) {
      // A reflected solid keeps its outward orientation. Corner values follow their vertices;
      // undefined p2/p3 must remain undefined so object/p1 inheritance stays intact.
      const indices = Array.from(this.#data.indices);
      for (let i = 0; i < indices.length; i += 3)
        [indices[i + 1], indices[i + 2]] = [indices[i + 2]!, indices[i + 1]!];
      const properties = this.#data.properties?.map((p) =>
        p ? { ...p, p2: p.p3, p3: p.p2 } : undefined,
      );
      return new MeshGeometry(positions, indices, properties);
    }
    return new MeshGeometry(
      positions,
      this.#data.indices,
      this.#data.properties,
    );
  }
  toData(): Mesh {
    return DataSnapshot.copy(this.#data);
  }
}
