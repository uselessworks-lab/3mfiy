import { DataSnapshot } from "./snapshot.js";
import { fail } from "../errors.js";
import { compositeWeights } from "../model/properties.js";
import type {
  Resource,
  ObjectResource,
  MeshObject,
  ComponentsObject,
  Component,
  Metadata,
  BaseMaterials,
  ColorGroup,
  Texture2D,
  Texture2DGroup,
  CompositeMaterials,
  MultiProperties,
} from "../model/types.js";
import { MeshGeometry } from "./geometry.js";

/** Resource identity is immutable. Models adopt a clone, never another model's live instance. */
export abstract class ResourceNode<T extends Resource = Resource> {
  protected readonly state: T;
  protected constructor(data: T) {
    if (!Number.isInteger(data.id) || data.id < 1 || data.id >= 2147483648)
      fail("RESOURCE_ID", "Resource ID must be a positive 31-bit integer");
    this.state = DataSnapshot.copy(data);
  }
  get id(): number {
    return this.state.id;
  }
  get kind(): T["kind"] {
    return this.state.kind;
  }
  toData(): T {
    return DataSnapshot.copy(this.state);
  }
  abstract clone(): ResourceNode<T>;
  static fromData(data: Resource): ResourceNode {
    switch (data.kind) {
      case "object":
        return data.mesh
          ? MeshResource.fromData(data)
          : ComponentsResource.fromData(data as ComponentsObject);
      case "baseMaterials":
        return new BaseMaterialsResource(data.id, data.bases);
      case "colorGroup":
        return new ColorGroupResource(data.id, data.colors);
      case "texture2d":
        return new TextureResource(data);
      case "texture2dGroup":
        return new TextureCoordinatesResource(
          data.id,
          data.textureId,
          data.coordinates,
        );
      case "compositeMaterials":
        return new CompositeMaterialsResource(data);
      case "multiProperties":
        return new MultiPropertiesResource(data);
      default:
        return fail("UNSUPPORTED_RESOURCE", "Unsupported resource kind");
    }
  }
}
export abstract class ObjectResourceNode<
  T extends ObjectResource = ObjectResource,
> extends ResourceNode<T> {
  get name(): string | undefined {
    return this.state.name;
  }
  get uuid(): string | undefined {
    return this.state.uuid;
  }
  setName(name: string): this {
    this.state.name = name;
    return this;
  }
  setType(type: NonNullable<ObjectResource["type"]>): this {
    this.state.type = type;
    return this;
  }
  setPartNumber(value: string): this {
    this.state.partNumber = value;
    return this;
  }
  setThumbnail(path: string | undefined): this {
    this.state.thumbnail = path;
    return this;
  }
  setUUID(value: string | undefined): this {
    this.state.uuid = value;
    return this;
  }
  setMetadata(metadata: readonly Metadata[]): this {
    this.state.metadata = DataSnapshot.copy(metadata);
    return this;
  }
}
export type MeshResourceOptions = Omit<MeshObject, "kind" | "id" | "mesh">;
export class MeshResource extends ObjectResourceNode<MeshObject> {
  constructor(
    id: number,
    geometry: MeshGeometry,
    options: MeshResourceOptions = {},
  ) {
    super({ ...options, kind: "object", id, mesh: geometry.toData() });
  }
  static override fromData(data: MeshObject): MeshResource {
    const { kind: _kind, id, mesh, ...options } = data;
    return new MeshResource(id, MeshGeometry.fromData(mesh), options);
  }
  get geometry(): MeshGeometry {
    return MeshGeometry.fromData(this.state.mesh);
  }
  replaceGeometry(geometry: MeshGeometry): this {
    this.state.mesh = geometry.toData();
    return this;
  }
  setProperty(pid: number, index: number): this {
    this.state.property = { pid, index };
    return this;
  }
  clearProperty(): this {
    delete this.state.property;
    return this;
  }
  override clone(): MeshResource {
    return MeshResource.fromData(this.state);
  }
}
export type ComponentsResourceOptions = Omit<
  ComponentsObject,
  "kind" | "id" | "components"
>;
export class ComponentsResource extends ObjectResourceNode<ComponentsObject> {
  constructor(
    id: number,
    components: readonly Component[] = [],
    options: ComponentsResourceOptions = {},
  ) {
    super({ ...options, kind: "object", id, components });
  }
  static override fromData(data: ComponentsObject): ComponentsResource {
    const { kind: _kind, id, components, ...options } = data;
    return new ComponentsResource(id, components, options);
  }
  get components(): readonly Component[] {
    return DataSnapshot.copy(this.state.components);
  }
  addComponent(component: Component): this {
    this.state.components = [
      ...this.state.components,
      DataSnapshot.copy(component),
    ];
    return this;
  }
  replaceComponents(components: readonly Component[]): this {
    this.state.components = DataSnapshot.copy(components);
    return this;
  }
  override clone(): ComponentsResource {
    return ComponentsResource.fromData(this.state);
  }
}
export abstract class PropertyResourceNode<
  T extends
    | BaseMaterials
    | ColorGroup
    | Texture2DGroup
    | CompositeMaterials
    | MultiProperties,
> extends ResourceNode<T> {
  abstract get count(): number;
}
export class BaseMaterialsResource extends PropertyResourceNode<BaseMaterials> {
  constructor(id: number, bases: BaseMaterials["bases"] = []) {
    super({ kind: "baseMaterials", id, bases });
  }
  override get count(): number {
    return this.state.bases.length;
  }
  add(name: string, displayColor: string): number {
    const index = this.count;
    this.state.bases = [...this.state.bases, { name, displayColor }];
    return index;
  }
  override clone(): BaseMaterialsResource {
    return new BaseMaterialsResource(this.id, this.state.bases);
  }
}
export class ColorGroupResource extends PropertyResourceNode<ColorGroup> {
  constructor(id: number, colors: readonly string[] = []) {
    super({ kind: "colorGroup", id, colors });
  }
  override get count(): number {
    return this.state.colors.length;
  }
  add(color: string): number {
    const index = this.count;
    this.state.colors = [...this.state.colors, color];
    return index;
  }
  override clone(): ColorGroupResource {
    return new ColorGroupResource(this.id, this.state.colors);
  }
}
export class TextureResource extends ResourceNode<Texture2D> {
  constructor(data: Texture2D) {
    super(data);
  }
  setImage(path: string, contentType: Texture2D["contentType"]): this {
    this.state.path = path;
    this.state.contentType = contentType;
    return this;
  }
  setSampling(
    options: Pick<Texture2D, "tileStyleU" | "tileStyleV" | "filter">,
  ): this {
    Object.assign(this.state, DataSnapshot.copy(options));
    return this;
  }
  override clone(): TextureResource {
    return new TextureResource(this.state);
  }
}
export class TextureCoordinatesResource extends PropertyResourceNode<Texture2DGroup> {
  constructor(
    id: number,
    textureId: number,
    coordinates: Texture2DGroup["coordinates"] = [],
  ) {
    super({ kind: "texture2dGroup", id, textureId, coordinates });
  }
  override get count(): number {
    return this.state.coordinates.length;
  }
  add(u: number, v: number): number {
    const index = this.count;
    this.state.coordinates = [...this.state.coordinates, { u, v }];
    return index;
  }
  override clone(): TextureCoordinatesResource {
    return new TextureCoordinatesResource(
      this.id,
      this.state.textureId,
      this.state.coordinates,
    );
  }
}
export class CompositeMaterialsResource extends PropertyResourceNode<CompositeMaterials> {
  constructor(data: CompositeMaterials) {
    super(data);
  }
  override get count(): number {
    return this.state.composites.length;
  }
  add(weights: readonly number[]): number {
    const index = this.count;
    this.state.composites = [...this.state.composites, [...weights]];
    return index;
  }
  weights(index: number): readonly number[] {
    return compositeWeights(this.state, index);
  }
  override clone(): CompositeMaterialsResource {
    return new CompositeMaterialsResource(this.state);
  }
}
export class MultiPropertiesResource extends PropertyResourceNode<MultiProperties> {
  constructor(data: MultiProperties) {
    super(data);
  }
  override get count(): number {
    return this.state.properties.length;
  }
  add(indices: readonly number[]): number {
    const index = this.count;
    this.state.properties = [...this.state.properties, [...indices]];
    return index;
  }
  override clone(): MultiPropertiesResource {
    return new MultiPropertiesResource(this.state);
  }
}
