import type {
  ThreeMFUnit,
  ThreeMFObjectType,
  TextureTileStyle,
  TextureFilter,
  BlendMethod,
} from "./enums.js";
/** 3MF numbers use JavaScript doubles; input buffers retain their original precision. */
export type NumericArray =
  | readonly number[]
  | Float32Array
  | Float64Array
  | Uint32Array
  | Uint16Array;
/** Accept enum members or the corresponding serialized values. */
export type Unit = `${ThreeMFUnit}`;
export type ObjectType = `${ThreeMFObjectType}`;
/** 3MF row-vector order: m00 m01 m02 m10 m11 m12 m20 m21 m22 tx ty tz. */
export type Transform = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];
export interface Metadata {
  name: string;
  value: string;
  preserve?: boolean;
  type?: string;
}
export interface TriangleProperties {
  pid?: number;
  p1?: number;
  p2?: number;
  p3?: number;
}
export interface Mesh {
  positions: NumericArray;
  indices: NumericArray;
  /** One entry per triangle. An undefined entry inherits object properties. */
  properties?: readonly (TriangleProperties | undefined)[];
}
export interface ObjectReference {
  objectId: number;
  path?: string;
  transform?: Transform;
  uuid?: string;
}
export interface Component extends ObjectReference {}
export interface BuildItem extends ObjectReference {
  partNumber?: string;
  metadata?: readonly Metadata[];
  printable?: boolean;
}
interface ObjectBase {
  kind: "object";
  id: number;
  name?: string;
  type?: ObjectType;
  partNumber?: string;
  thumbnail?: string;
  uuid?: string;
  metadata?: readonly Metadata[];
}
export interface MeshObject extends ObjectBase {
  mesh: Mesh;
  components?: never;
  property?: { pid: number; index: number };
}
export interface ComponentsObject extends ObjectBase {
  components: readonly Component[];
  mesh?: never;
  property?: never;
}
export type ObjectResource = MeshObject | ComponentsObject;
export interface BaseMaterials {
  kind: "baseMaterials";
  id: number;
  bases: readonly { name: string; displayColor: string }[];
}
export interface ColorGroup {
  kind: "colorGroup";
  id: number;
  colors: readonly string[];
}
export interface Texture2D {
  kind: "texture2d";
  id: number;
  path: string;
  contentType: "image/png" | "image/jpeg";
  tileStyleU?: `${TextureTileStyle}`;
  tileStyleV?: `${TextureTileStyle}`;
  filter?: `${TextureFilter}`;
}
export interface Texture2DGroup {
  kind: "texture2dGroup";
  id: number;
  textureId: number;
  coordinates: readonly { u: number; v: number }[];
}
export interface CompositeMaterials {
  kind: "compositeMaterials";
  id: number;
  materialId: number;
  materialIndices: readonly number[];
  composites: readonly (readonly number[])[];
}
export interface MultiProperties {
  kind: "multiProperties";
  id: number;
  propertyIds: readonly number[];
  blendMethods?: readonly `${BlendMethod}`[];
  properties: readonly (readonly number[])[];
}
export type PropertyResource =
  | BaseMaterials
  | ColorGroup
  | Texture2DGroup
  | CompositeMaterials
  | MultiProperties;
export type Resource = ObjectResource | PropertyResource | Texture2D;
/** Namespace URIs, not prefixes, identify extensions. Unknown required extensions are rejected. */
export interface Model {
  path: string;
  unit?: Unit;
  language?: string;
  metadata?: readonly Metadata[];
  namespaces?: Readonly<Record<string, string>>;
  requiredExtensions?: readonly string[];
  recommendedExtensions?: readonly string[];
  resources: readonly Resource[];
  build: readonly BuildItem[];
  buildUuid?: string;
}
export interface PackagePart {
  path: string;
  contentType: string;
  data: Uint8Array;
}
export interface Relationship {
  /** Omit for a package-root relationship. */
  source?: string;
  id?: string;
  type: string;
  target: string;
  external?: boolean;
}
export interface Document {
  root: string;
  models: readonly Model[];
  /** Opaque attachments are retained byte-for-byte (including vendor configuration). */
  attachments?: readonly PackagePart[];
  relationships?: readonly Relationship[];
}
export interface Diagnostic {
  severity: "error" | "warning";
  code: string;
  path: string;
  message: string;
}
export interface ValidationOptions {
  /** Also check oriented two-manifold edges. Does not repair geometry. */ topology?: boolean;
}
export interface ReadLimits {
  maxArchiveBytes?: number;
  maxEntries?: number;
  maxPartBytes?: number;
  maxTotalBytes?: number;
  maxXmlDepth?: number;
  maxXmlNodes?: number;
}
export interface ReadOptions {
  limits?: ReadLimits;
  validation?: ValidationOptions;
}
export interface ReadResult {
  document: Document;
  diagnostics: readonly Diagnostic[];
}
export interface WriteOptions {
  compressionLevel?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  validation?: ValidationOptions;
}
