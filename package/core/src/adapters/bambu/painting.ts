import { bambuPaintSlots } from "../../model/bambu-paint.js";
import { MeshGeometry } from "../../domain/geometry.js";
import { fail } from "../../errors.js";
import type { BambuTrianglePaint } from "../../model/types.js";
type Point = readonly [number, number, number];
export interface BambuPaintingOptions {
  /** Caller-owned model units, normally millimeters. */
  maxEdgeLength: number;
  maxDepth?: number;
  maxNodes?: number;
}
/** Creates logical facet paint trees; original vertex/index buffers never change. */
export class BambuFacetPainting {
  /** Visits logical colored patches for a preview; creates no mesh resources. */
  static visit(
    geometry: MeshGeometry,
    forest: readonly (BambuTrianglePaint | undefined)[],
    visitor: (
      points: readonly Point[],
      slot: number | undefined,
      triangle: number,
    ) => void,
  ): void {
    const data = geometry.toData();
    if (forest.length !== data.indices.length / 3)
      fail("BAMBU_PAINT", "Paint forest must align with triangles");
    let nodes = 0;
    const mid = (a: Point, b: Point): Point => [
      (a[0] + b[0]) / 2,
      (a[1] + b[1]) / 2,
      (a[2] + b[2]) / 2,
    ];
    const walk = (
      points: readonly Point[],
      paint: BambuTrianglePaint | undefined,
      face: number,
      depth: number,
    ): void => {
      if (++nodes > 1000000 || depth > 64)
        fail("BAMBU_PAINT", "Painting traversal budget exceeded");
      if (paint === undefined || typeof paint === "number") {
        visitor(points, paint, face);
        return;
      }
      const a = points[paint.side]!,
        b = points[(paint.side + 1) % 3]!,
        c = points[(paint.side + 2) % 3]!;
      let children: Point[][];
      if (paint.split === 1) {
        const m = mid(b, c);
        children = [
          [a, b, m],
          [m, c, a],
        ];
      } else if (paint.split === 2) {
        const ab = mid(a, b),
          ca = mid(c, a);
        children = [
          [a, ab, ca],
          [ab, b, ca],
          [b, c, ca],
        ];
      } else {
        const ab = mid(a, b),
          bc = mid(b, c),
          ca = mid(c, a);
        children = [
          [a, ab, ca],
          [ab, b, bc],
          [bc, c, ca],
          [ab, bc, ca],
        ];
      }
      children.forEach((child, i) =>
        walk(child, paint.children[i], face, depth + 1),
      );
    };
    forest.forEach((paint, face) => {
      bambuPaintSlots(paint);
      const points = [0, 1, 2].map((k) => {
        const i = data.indices[face * 3 + k]!;
        if (!Number.isInteger(i) || i < 0 || i >= data.positions.length / 3)
          fail("BAMBU_PAINT", "Invalid vertex index");
        return [
          data.positions[i * 3]!,
          data.positions[i * 3 + 1]!,
          data.positions[i * 3 + 2]!,
        ] as Point;
      });
      walk(points, paint, face, 0);
    });
  }
  static sample(
    geometry: MeshGeometry,
    sample: (
      point: Point,
      triangle: number,
      barycentric: Point,
    ) => number | undefined,
    options: BambuPaintingOptions,
  ): readonly (BambuTrianglePaint | undefined)[] {
    const { maxEdgeLength, maxDepth = 14, maxNodes = 1000000 } = options;
    if (
      !Number.isFinite(maxEdgeLength) ||
      maxEdgeLength <= 0 ||
      !Number.isInteger(maxDepth) ||
      maxDepth < 0 ||
      maxDepth > 32 ||
      !Number.isInteger(maxNodes) ||
      maxNodes < 1 ||
      maxNodes > 1000000
    )
      fail("BAMBU_PAINT", "Invalid painting sampling limits");
    const data = geometry.toData();
    let nodes = 0;
    if (data.indices.length % 3 || data.positions.length % 3)
      fail("BAMBU_PAINT", "Incomplete mesh buffers");
    const midpoint = (a: Point, b: Point): Point => [
      (a[0] + b[0]) / 2,
      (a[1] + b[1]) / 2,
      (a[2] + b[2]) / 2,
    ];
    const squared = (a: Point, b: Point) =>
      (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
    const result: (BambuTrianglePaint | undefined)[] = [];
    for (let face = 0; face < data.indices.length / 3; face++) {
      const original = [0, 1, 2].map((k) => {
        const i = data.indices[face * 3 + k]!;
        if (!Number.isInteger(i) || i < 0 || i >= data.positions.length / 3)
          fail("BAMBU_PAINT", "Invalid vertex index");
        const p = [
          data.positions[i * 3]!,
          data.positions[i * 3 + 1]!,
          data.positions[i * 3 + 2]!,
        ] as Point;
        if (p.some((v) => !Number.isFinite(v)))
          fail("BAMBU_PAINT", "Nonfinite vertex");
        return p;
      });
      const position = (b: Point): Point =>
        [0, 1, 2].map((k) =>
          original.reduce((sum, p, i) => sum + p[k]! * b[i]!, 0),
        ) as unknown as Point;
      function paint(
        bary: readonly Point[],
        depth: number,
      ): BambuTrianglePaint | undefined {
        if (++nodes > maxNodes)
          fail("BAMBU_PAINT", "Painting node budget exceeded");
        const [a, b, c] = bary as [Point, Point, Point],
          pa = position(a),
          pb = position(b),
          pc = position(c);
        if (
          Math.max(squared(pa, pb), squared(pb, pc), squared(pc, pa)) <=
          maxEdgeLength ** 2
        ) {
          const center: [number, number, number] = [
              (a[0] + b[0] + c[0]) / 3,
              (a[1] + b[1] + c[1]) / 3,
              (a[2] + b[2] + c[2]) / 3,
            ],
            slot = sample(position(center), face, center);
          if (
            slot !== undefined &&
            (!Number.isInteger(slot) || slot < 1 || slot > 255)
          )
            fail("BAMBU_PAINT", "Sampler must return a filament slot 1..255");
          return slot;
        }
        if (depth >= maxDepth)
          fail("BAMBU_PAINT", "Painting depth budget exceeded");
        const ab = midpoint(a, b),
          bc = midpoint(b, c),
          ca = midpoint(c, a),
          children = [
            [a, ab, ca],
            [ab, b, bc],
            [bc, c, ca],
            [ab, bc, ca],
          ].map((child) => paint(child, depth + 1));
        if (
          children.every((child) => child === children[0]) &&
          (children[0] === undefined || typeof children[0] === "number")
        )
          return children[0];
        return { split: 3, side: 0, children };
      }
      result.push(
        paint(
          [
            [1, 0, 0],
            [0, 1, 0],
            [0, 0, 1],
          ],
          0,
        ),
      );
    }
    return result;
  }
}
