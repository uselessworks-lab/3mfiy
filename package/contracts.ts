/** Neutral printing graph. This entry contains types only and loads no XML/ZIP writer. */
export type NonEmpty<T> = readonly [T, ...T[]];
/** Column-major affine 4×4, mm and +Z up. */
export type Matrix4 = readonly [number, number, number, number, number, number, number, number,
  number, number, number, number, number, number, number, number];
export interface PortableMesh { readonly positions: Float32Array | Float64Array; readonly indices: Uint32Array; readonly normals?: Float32Array }
export interface Material { readonly id: string; readonly label?: string; readonly color: string }
export interface ResultEntity { readonly id: string; readonly label?: string; readonly properties?: Readonly<Record<string, unknown>> }
export interface EntityProperties { readonly entityIds?: readonly string[]; readonly properties?: Readonly<Record<string, unknown>> }
export interface ObjectPrintSettings {
  readonly name?: string;
  readonly settings?: Readonly<Record<string, string>>;
  /** Object pose before plate packing; retained for later repacking of the same object. */
  readonly orientation?: Matrix4;
}
export interface PartPrintSettings extends Omit<ObjectPrintSettings, 'orientation'> {
  readonly filamentPriority?: number;
  readonly filamentSlot?: number;
  readonly materialName?: string;
}
export interface OutputComponent extends EntityProperties {
  readonly id: string;
  readonly geometryId: string;
  readonly materialId?: string;
  readonly print?: PartPrintSettings;
  readonly transform?: Matrix4;
}
export interface OutputRepresentation { readonly id: string; readonly components: NonEmpty<OutputComponent> }
export interface Output extends EntityProperties {
  readonly id: string;
  readonly label?: string;
  readonly print?: ObjectPrintSettings;
  readonly representations: NonEmpty<OutputRepresentation>;
}
export interface OutputGeometry {
  readonly id: string;
  readonly mesh: PortableMesh;
  readonly kind: 'solid' | 'mesh';
  readonly volume?: number;
  readonly bounds: { readonly min: readonly number[]; readonly max: readonly number[] };
}
export interface OutputPlacement {
  readonly instanceId?: string;
  readonly outputId: string;
  readonly representationId: string;
  readonly transform: Matrix4;
}
export interface AssemblyPlan { readonly placements: NonEmpty<OutputPlacement> }
interface PlateIdentity { readonly id: string; readonly name?: string; readonly locked?: boolean; readonly origin?: readonly [number, number] }
export type PrintPlate = PlateIdentity & (
  { readonly extent?: 'rectangle'; readonly width: number; readonly depth: number }
  | { readonly extent: 'unspecified' }
);
export interface PrintPlacement extends OutputPlacement {
  readonly plateId: string;
  /** Explicit archive scene pose, when its exact arithmetic differs from origin + plate-local pose. */
  readonly sceneTransform?: Matrix4;
}
export interface PrintPlan {
  readonly boundsPolicy?: 'strict' | 'allow-overflow';
  readonly outputIds: NonEmpty<string>;
  readonly plates: NonEmpty<PrintPlate>;
  readonly placements: NonEmpty<PrintPlacement>;
}
export interface ManufacturingEligibility { readonly eligible: boolean; readonly reason?: string }
export interface PrintableProject<G extends { readonly id: string } = OutputGeometry> {
  readonly outputs: NonEmpty<Output>;
  readonly geometries: NonEmpty<G>;
  readonly materials?: readonly Material[];
  readonly assembly?: AssemblyPlan;
  readonly printing?: PrintPlan;
  readonly manufacturing?: ManufacturingEligibility;
}
export interface ThreeMfMetadata {
  readonly namespaces?: Readonly<Record<string, string>>;
  readonly metadata: readonly { readonly name: string; readonly value: string }[];
  readonly attachments?: readonly { readonly path: string; readonly contentType: string; readonly text: string }[];
}
export interface ThreeMfOptions {
  readonly title: string;
  readonly format: 'standard' | 'bambu-project';
  readonly metadata?: ThreeMfMetadata;
  readonly defaultColor?: string;
  readonly assembly?: 'physical' | 'print' | 'omit';
  /** Bake part and print scene transforms into vertices and emit identity build transforms. */
  readonly bakeTransforms?: boolean;
  readonly project?: {
    readonly applicationVersion: string;
    readonly profile: import('./adapters/bambu/types.js').BambuProjectSettings;
    readonly meshPath: string;
    readonly meshPaths?: Readonly<Record<string, string>>;
    readonly metadata?: ThreeMfMetadata['metadata'];
  };
}
