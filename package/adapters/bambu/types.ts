import type { Transform } from "../../model/types.js";
/** Bambu ConfigBase::save_to_json wire values; numeric/bool settings are serialized strings. */
export type BambuConfig = Readonly<Record<string, string | readonly string[]>>;
export type BambuProjectSettings = BambuConfig & {
  readonly printer_settings_id?: string;
  readonly print_settings_id?: string;
  readonly filament_settings_id?: readonly string[];
  readonly filament_colour?: readonly string[];
  readonly filament_type?: readonly string[];
  readonly filament_ids?: readonly string[];
  readonly nozzle_diameter?: readonly string[];
  readonly flush_volumes_matrix?: readonly string[];
};
export type BambuSettings = Readonly<Record<string, string | number | boolean>>;
export interface BambuFilamentSlot {
  settingsId: string;
  color: string;
  type?: string;
  filamentId?: string;
}
/** Serialized presets. Writing requires a nonempty inherits parent available in Studio; no inheritance resolution or profile fetching. */
export type BambuEmbeddedPreset = {
  kind: `${BambuPresetKind}`;
  config: BambuConfig;
};
export enum BambuPartSubtype {
  Normal = "normal_part",
  Negative = "negative_part",
  Modifier = "modifier_part",
  SupportEnforcer = "support_enforcer",
  SupportBlocker = "support_blocker",
}
export enum BambuPrintSequence {
  ByLayer = "by layer",
  ByObject = "by object",
}
export enum BambuPresetKind {
  Process = "process",
  Filament = "filament",
  Machine = "machine",
}
export interface BambuPartSettings {
  objectId: number;
  name?: string;
  /** 1-based project filament slot, not a physical nozzle index. */
  extruder?: number;
  subtype?: `${BambuPartSubtype}`;
  settings?: BambuSettings;
}
export interface BambuObjectSettings {
  objectId: number;
  name?: string;
  extruder?: number;
  settings?: BambuSettings;
  /** Settings for distinct direct mesh components only; nested component targets are rejected. */
  parts?: readonly BambuPartSettings[];
}
export interface BambuInstance {
  objectId: number;
  instanceId: number;
  identifyId: number;
}
export interface BambuPlate {
  /** Contiguous 1-based IDs. Empty plates are allowed. */
  id: number;
  name?: string;
  locked?: boolean;
  bedType?: string;
  printSequence?: `${BambuPrintSequence}`;
  spiralMode?: boolean;
  /** Serialized Bambu enum value, e.g. Manual; not an AMS tray selection. */
  filamentMapMode?: string;
  /** Project filament slot -> 1-based physical extruder. */
  filamentMaps?: readonly number[];
  /** Project filament slot -> nozzle volume type (0 or 1). */
  filamentVolumeMaps?: readonly (0 | 1)[];
  firstLayerPrintSequence?: readonly number[];
  /** Vendor layer-range encoding, preserved as integers. */
  otherLayersPrintSequence?: readonly number[];
  otherLayersPrintSequenceNums?: number;
  /** Caller-rendered PNG bytes; the adapter does not render geometry. */
  thumbnail?: Uint8Array;
  /** Extra serialized metadata; typed fields and asset/gcode references cannot be shadowed. */
  settings?: BambuSettings;
  instances: readonly BambuInstance[];
}
export interface BambuAssemblyItem {
  objectId: number;
  instanceId: number;
  transform: Transform;
  offset?: readonly [number, number, number];
}
export interface BambuProject {
  applicationVersion: string;
  projectSettings: BambuProjectSettings;
  objects: readonly BambuObjectSettings[];
  plates: readonly BambuPlate[];
  assembly?: readonly BambuAssemblyItem[];
  /** Omitted preserves existing embedded presets; a supplied array replaces the whole preset collection. */
  embeddedPresets?: readonly BambuEmbeddedPreset[];
}
