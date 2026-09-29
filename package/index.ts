export { ThreeMFDocument } from "./domain/document.js";
export { ThreeMFModel } from "./domain/model.js";
export type { ModelSettings } from "./domain/model.js";
export { MeshGeometry, Transform3D } from "./domain/geometry.js";
export {
  ResourceNode,
  ObjectResourceNode,
  PropertyResourceNode,
  MeshResource,
  ComponentsResource,
  BaseMaterialsResource,
  ColorGroupResource,
  TextureResource,
  TextureCoordinatesResource,
  CompositeMaterialsResource,
  MultiPropertiesResource,
} from "./domain/resources.js";
export type {
  MeshResourceOptions,
  ComponentsResourceOptions,
} from "./domain/resources.js";
export { ThreeMFBuilder } from "./model/create.js";
export type {
  Create3mfPart,
  Create3mfObject,
  Create3mfOptions,
  Create3mfResult,
} from "./model/create.js";
export {
  ThreeMFUnit,
  ThreeMFObjectType,
  TextureTileStyle,
  TextureFilter,
  BlendMethod,
} from "./model/enums.js";
export { NS, REL, CONTENT_TYPE, DEFAULT_MODEL_PATH } from "./constants.js";
export { DEFAULT_READ_LIMITS } from "./opc/zip.js";
export { ThreeMFError } from "./errors.js";
/** Plain-data contracts are explicit serialization boundaries, not the authoring API. */
export type {
  Document as DocumentData,
  Model as ModelData,
  Resource as ResourceData,
  Mesh as MeshData,
  ObjectResource as ObjectResourceData,
  MeshObject as MeshObjectData,
  ComponentsObject as ComponentsObjectData,
  BaseMaterials as BaseMaterialsData,
  ColorGroup as ColorGroupData,
  Texture2D as TextureData,
  Texture2DGroup as TextureCoordinatesData,
  CompositeMaterials as CompositeMaterialsData,
  MultiProperties as MultiPropertiesData,
  Transform as TransformData,
  NumericArray,
  Unit,
  ObjectType,
  Metadata,
  Component,
  BuildItem,
  TriangleProperties,
  PackagePart,
  Relationship,
  Diagnostic,
  ValidationOptions,
  ReadLimits,
  ReadOptions,
  WriteOptions,
} from "./model/types.js";
