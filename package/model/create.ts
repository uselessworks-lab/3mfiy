import { DataSnapshot } from "../domain/snapshot.js";
import { ThreeMFDocument } from "../domain/document.js";
import { MeshGeometry, Transform3D } from "../domain/geometry.js";
import { ThreeMFUnit } from "./enums.js";
import { DEFAULT_MODEL_PATH } from "../constants.js";
import { fail } from "../errors.js";
import type { Metadata, Unit } from "./types.js";
export interface Create3mfPart {
  name?: string;
  mesh: MeshGeometry;
  color?: string;
  materialName?: string;
  /** One sRGB hex color per mesh vertex. Creates a Materials color group and corner indices. */
  vertexColors?: readonly string[];
  transform?: Transform3D;
}
export interface Create3mfObject {
  name?: string;
  parts: readonly Create3mfPart[];
  transform?: Transform3D;
  partNumber?: string;
}
export interface Create3mfOptions {
  unit?: Unit;
  language?: string;
  metadata?: readonly Metadata[];
  namespaces?: Readonly<Record<string, string>>;
  rootPath?: string;
  /** Omit for a single Core model; supply to separate meshes with Production. */
  meshPath?: string;
  uuid?: () => string;
}
export interface Create3mfResult {
  document: ThreeMFDocument;
  /** Bindings belong to this build. IDs and generated UUIDs are not stable across builds. */
  objects: readonly {
    objectId: number;
    partIds: readonly number[];
    meshPath: string;
  }[];
}
/** Creates owned domain objects. Each build is independent and leaves previous results intact. */
export class ThreeMFBuilder {
  readonly #objects: Create3mfObject[] = [];
  readonly #options: Create3mfOptions;
  constructor(options: Create3mfOptions = {}) {
    const { uuid, ...data } = options;
    this.#options = { ...DataSnapshot.copy(data), uuid };
  }
  addObject(object: Create3mfObject): this {
    // Geometry and transforms are immutable value objects; snapshot the request containers.
    this.#objects.push({
      ...object,
      parts: object.parts.map((part) => ({
        ...part,
        vertexColors: part.vertexColors?.slice(),
      })),
    });
    return this;
  }
  build(): Create3mfResult {
    if (
      !this.#objects.length ||
      this.#objects.some((object) => !object.parts.length)
    )
      fail(
        "EMPTY_DOCUMENT",
        "Provide at least one object and one part per object",
      );
    const rootPath = this.#options.rootPath ?? DEFAULT_MODEL_PATH;
    let document = new ThreeMFDocument(rootPath, {
      unit: this.#options.unit ?? ThreeMFUnit.Millimeter,
      language: this.#options.language ?? "und",
      metadata: this.#options.metadata,
      namespaces: this.#options.namespaces,
    });
    const root = document.rootModel;
    const meshPath = this.#options.meshPath ?? rootPath;
    const meshModel =
      meshPath === rootPath
        ? root
        : document.createModel(meshPath, {
            unit: root.unit,
            language: root.language,
          });
    const materials = this.collectMaterials();
    const palette = materials.size ? meshModel.addBaseMaterials() : undefined;
    for (const { name, color } of materials.values()) palette!.add(name, color);
    const objects: Create3mfResult["objects"][number][] = [];
    for (const object of this.#objects) {
      const parts = object.parts.map((part) => {
        let geometry = part.mesh;
        let property: { pid: number; index: number } | undefined;
        if (part.vertexColors) {
          const data = part.mesh.toData();
          if (
            part.vertexColors.length !== part.mesh.vertexCount ||
            data.properties?.some(Boolean)
          )
            fail(
              "VERTEX_COLORS",
              "Provide one color per vertex and no conflicting triangle properties",
            );
          const colors = meshModel.addColorGroup(),
            indices = new Map<string, number>();
          const vertices = part.vertexColors.map((color) => {
            if (
              typeof color !== "string" ||
              !/^#[\da-f]{6}([\da-f]{2})?$/i.test(color)
            )
              fail(
                "VERTEX_COLORS",
                "Vertex colors must be sRGB #RRGGBB or #RRGGBBAA strings",
              );
            const key = color.toUpperCase();
            if (!indices.has(key)) indices.set(key, colors.add(key));
            return indices.get(key)!;
          });
          geometry = MeshGeometry.fromData({
            ...data,
            properties: Array.from(
              { length: part.mesh.triangleCount },
              (_, i) => ({
                pid: colors.id,
                p1: vertices[data.indices[i * 3]!]!,
                p2: vertices[data.indices[i * 3 + 1]!]!,
                p3: vertices[data.indices[i * 3 + 2]!]!,
              }),
            ),
          });
          property = { pid: colors.id, index: 0 };
        } else if (part.color)
          property = {
            pid: palette!.id,
            index: materials.get(this.materialKey(part))!.index,
          };
        // Property resources must precede every mesh that references them.
        const mesh = meshModel.addMesh(geometry, { name: part.name });
        if (property) mesh.setProperty(property.pid, property.index);
        return mesh;
      });
      const group = root.addComponents({
        name: object.name,
        partNumber: object.partNumber,
      });
      for (const [i, part] of parts.entries())
        group.addComponent({
          objectId: part.id,
          path: meshModel === root ? undefined : meshPath,
          transform: object.parts[i]!.transform?.toData(),
        });
      root.addBuildItem({
        objectId: group.id,
        transform: object.transform?.toData(),
        partNumber: object.partNumber,
      });
      objects.push({
        objectId: group.id,
        partIds: parts.map((part) => part.id),
        meshPath,
      });
    }
    if (meshModel !== root)
      document = document.withProductionUUIDs(this.#options.uuid);
    document.assertValid();
    return { document, objects };
  }
  private materialKey(part: Create3mfPart): string {
    return JSON.stringify([
      part.materialName ?? part.color,
      part.color!.toUpperCase(),
    ]);
  }
  private collectMaterials(): Map<
    string,
    { index: number; name: string; color: string }
  > {
    const materials = new Map<
      string,
      { index: number; name: string; color: string }
    >();
    for (const object of this.#objects)
      for (const part of object.parts) {
        if (!part.color) continue;
        const key = this.materialKey(part);
        if (!materials.has(key))
          materials.set(key, {
            index: materials.size,
            name: part.materialName ?? part.color,
            color: part.color,
          });
      }
    return materials;
  }
}
