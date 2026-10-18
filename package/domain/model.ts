import { DataSnapshot } from "./snapshot.js";
import { fail } from "../errors.js";
import { ThreeMFUnit } from "../model/enums.js";
import { partPath } from "../opc/paths.js";
import { triangleProperties } from "../model/properties.js";
import type { Model, BuildItem, Metadata, Unit } from "../model/types.js";
import { MeshGeometry } from "./geometry.js";
import {
  ResourceNode,
  ObjectResourceNode,
  MeshResource,
  ComponentsResource,
  BaseMaterialsResource,
  ColorGroupResource,
  type MeshResourceOptions,
  type ComponentsResourceOptions,
} from "./resources.js";
export type ModelSettings = Omit<Model, "path" | "resources" | "build">;

/** Owns resource identities and build instances for one immutable model path. */
export class ThreeMFModel {
  readonly #header: ModelSettings & { path: string };
  readonly #resources = new Map<number, ResourceNode>();
  #build: BuildItem[] = [];
  constructor(path: string, settings: ModelSettings = {}) {
    partPath(path);
    this.#header = DataSnapshot.copy({
      unit: ThreeMFUnit.Millimeter,
      ...settings,
      path,
    });
  }
  static fromData(data: Model): ThreeMFModel {
    const { resources, build, path, ...settings } = data;
    const model = new ThreeMFModel(path, settings);
    for (const resource of resources)
      model.insert(ResourceNode.fromData(resource));
    model.#build = DataSnapshot.copy([...build]);
    return model;
  }
  get path(): string {
    return this.#header.path;
  }
  get unit(): Unit | undefined {
    return this.#header.unit;
  }
  get language(): string | undefined {
    return this.#header.language;
  }
  get resources(): readonly ResourceNode[] {
    return [...this.#resources.values()];
  }
  get objects(): readonly ObjectResourceNode[] {
    return this.resources.filter(
      (r): r is ObjectResourceNode => r instanceof ObjectResourceNode,
    );
  }
  get buildItems(): readonly BuildItem[] {
    return DataSnapshot.copy(this.#build);
  }
  get metadata(): readonly Metadata[] {
    return DataSnapshot.copy(this.#header.metadata ?? []);
  }
  setUnit(unit: Unit): this {
    this.#header.unit = unit;
    return this;
  }
  setLanguage(language: string): this {
    this.#header.language = language;
    return this;
  }
  setMetadata(metadata: readonly Metadata[]): this {
    this.#header.metadata = DataSnapshot.copy(metadata);
    return this;
  }
  setNamespaces(namespaces: Readonly<Record<string, string>>): this {
    this.#header.namespaces = DataSnapshot.copy(namespaces);
    return this;
  }
  setExtensions(
    required: readonly string[],
    recommended: readonly string[] = [],
  ): this {
    this.#header.requiredExtensions = [...required];
    this.#header.recommendedExtensions = [...recommended];
    return this;
  }
  setBuildUUID(uuid: string | undefined): this {
    this.#header.buildUuid = uuid;
    return this;
  }
  nextResourceId(): number {
    let id = 1;
    while (this.#resources.has(id)) id++;
    if (id >= 2147483648) fail("RESOURCE_ID", "No resource IDs available");
    return id;
  }
  getResource(id: number): ResourceNode | undefined {
    return this.#resources.get(id);
  }
  requireResource(id: number): ResourceNode {
    return (
      this.getResource(id) ??
      fail("RESOURCE_REFERENCE", `Missing resource ${id} in ${this.path}`)
    );
  }
  /** Adopts a clone and returns the owned instance. The supplied instance stays independent. */
  addResource<T extends ResourceNode>(resource: T): ReturnType<T["clone"]> {
    return this.insert(resource.clone()) as ReturnType<T["clone"]>;
  }
  /** Replace in place without changing declaration order. References are checked on validate/write. */
  replaceResource<T extends ResourceNode>(resource: T): ReturnType<T["clone"]> {
    this.requireResource(resource.id);
    const owned = resource.clone();
    this.#resources.set(owned.id, owned);
    return owned as ReturnType<T["clone"]>;
  }
  addMesh(
    geometry: MeshGeometry,
    options: MeshResourceOptions = {},
  ): MeshResource {
    return this.insert(
      new MeshResource(this.nextResourceId(), geometry, options),
    );
  }
  addComponents(options: ComponentsResourceOptions = {}): ComponentsResource {
    return this.insert(
      new ComponentsResource(this.nextResourceId(), [], options),
    );
  }
  addBaseMaterials(): BaseMaterialsResource {
    return this.insert(new BaseMaterialsResource(this.nextResourceId()));
  }
  addColorGroup(): ColorGroupResource {
    return this.insert(new ColorGroupResource(this.nextResourceId()));
  }
  addBuildItem(item: BuildItem): number {
    const index = this.#build.length;
    this.#build.push(DataSnapshot.copy(item));
    return index;
  }
  updateBuildItem(index: number, item: BuildItem): this {
    if (!Number.isInteger(index) || index < 0 || index >= this.#build.length)
      fail("BUILD_INDEX", "Build item is out of range");
    this.#build[index] = DataSnapshot.copy(item);
    return this;
  }
  removeBuildItem(index: number): BuildItem {
    if (!Number.isInteger(index) || index < 0 || index >= this.#build.length)
      fail("BUILD_INDEX", "Build item is out of range");
    return DataSnapshot.copy(this.#build.splice(index, 1)[0]!);
  }
  triangleProperty(
    objectId: number,
    triangle: number,
  ):
    | { resource: ResourceNode; indices: readonly [number, number, number] }
    | undefined {
    const object = this.requireResource(objectId);
    if (!(object instanceof MeshResource))
      fail("OBJECT_SHAPE", "Triangle properties require a mesh object");
    const property = triangleProperties(
      this.toData(),
      object.toData(),
      triangle,
    );
    return property
      ? {
          resource: this.requireResource(property.resource.id),
          indices: property.indices,
        }
      : undefined;
  }
  clone(): ThreeMFModel {
    return ThreeMFModel.fromData(this.toData());
  }
  toData(): Model {
    return {
      ...DataSnapshot.copy(this.#header),
      resources: this.resources.map((r) => r.toData()),
      build: DataSnapshot.copy(this.#build),
    };
  }
  private insert<T extends ResourceNode>(resource: T): T {
    if (this.#resources.has(resource.id))
      fail(
        "DUPLICATE_RESOURCE",
        `Resource ${resource.id} already exists in ${this.path}`,
      );
    this.#resources.set(resource.id, resource);
    return resource;
  }
}
