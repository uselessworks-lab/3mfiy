import { fail } from "../errors.js";
import type {
  CompositeMaterials,
  MeshObject,
  Model,
  PropertyResource,
} from "./types.js";
import { isProperty } from "../extensions/materials.js";
/** Resolve Core triangle inheritance. Does not render/interpolate materials. */
export function triangleProperties(
  model: Model,
  object: MeshObject,
  triangle: number,
):
  | { resource: PropertyResource; indices: readonly [number, number, number] }
  | undefined {
  if (
    !Number.isInteger(triangle) ||
    triangle < 0 ||
    triangle >= object.mesh.indices.length / 3
  )
    fail("TRIANGLE_INDEX", "Triangle is out of bounds");
  const p = object.mesh.properties?.[triangle],
    pid = p?.pid ?? object.property?.pid,
    p1 = p?.p1 ?? object.property?.index;
  if (pid === undefined || p1 === undefined) return undefined;
  const resource = model.resources.find((r) => r.id === pid);
  if (!resource || !isProperty(resource))
    fail("PROPERTY_REFERENCE", `Missing property resource ${pid}`);
  return { resource, indices: [p1, p?.p2 ?? p1, p?.p3 ?? p1] };
}
/** Materials §4.1: pad missing weights, ignore extras, normalize, use equal shares for zero sum. */
export function compositeWeights(
  resource: CompositeMaterials,
  index: number,
): readonly number[] {
  const row = resource.composites[index];
  if (!row) fail("PROPERTY_INDEX", "Composite index out of bounds");
  const values = resource.materialIndices.map((_, i) => row[i] ?? 0),
    sum = values.reduce((a, b) => a + b, 0);
  return values.map((value) => (sum === 0 ? 1 / values.length : value / sum));
}
