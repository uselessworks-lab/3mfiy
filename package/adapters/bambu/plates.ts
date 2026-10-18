import { BambuPrintSequence } from "./types.js";
import { fail } from "../../errors.js";
import type { Document, PackagePart } from "../../model/types.js";
import {
  element,
  parseXml,
  requiredAttr,
  checkNode,
} from "../../xml/primitives.js";
import { pathKey } from "../../opc/paths.js";
import type { BambuPlate, BambuSettings } from "./types.js";
export const PLATE_FIELDS = {
  bedType: "bed_type",
  printSequence: "print_sequence",
  spiralMode: "spiral_mode",
  filamentMapMode: "filament_map_mode",
  filamentMaps: "filament_maps",
  filamentVolumeMaps: "filament_volume_maps",
  firstLayerPrintSequence: "first_layer_print_sequence",
  otherLayersPrintSequence: "other_layers_print_sequence",
  otherLayersPrintSequenceNums: "other_layers_print_sequence_nums",
} as const;
const specialKeys = [
  "plater_id",
  "plater_name",
  "locked",
  "thumbnail_file",
  ...Object.values(PLATE_FIELDS),
];
const unsupportedAssetKeys = [
  "gcode_file",
  "thumbnail_no_light_file",
  "top_file",
  "pick_file",
  "pattern_file",
  "pattern_bbox_file",
];
export const isPositiveId = (value: number, min = 1) =>
  Number.isInteger(value) && value >= min && value < 2147483648;
export function settingsXml(settings: BambuSettings): string {
  return Object.entries(settings)
    .map(([key, value]) => {
      if (
        !["string", "number", "boolean"].includes(typeof value) ||
        (typeof value === "number" && !Number.isFinite(value))
      )
        fail("BAMBU_SETTING", "Local settings must be scalar finite values");
      return element("metadata", {
        key,
        value: typeof value === "boolean" ? (value ? "1" : "0") : value,
      });
    })
    .join("");
}
export function thumbnailPath(id: number): string {
  return `/Metadata/plate_${id}.png`;
}
export function plateMetadata(
  plate: BambuPlate,
  slotCount?: number,
  nozzleCount?: number,
): BambuSettings {
  for (const key of Object.keys(plate.settings ?? {}))
    if (specialKeys.includes(key) || unsupportedAssetKeys.includes(key))
      fail(
        "BAMBU_PLATE",
        `Use typed plate fields; unsupported asset override ${key}`,
      );
  if (
    plate.printSequence !== undefined &&
    !Object.values<string>(BambuPrintSequence).includes(plate.printSequence)
  )
    fail("BAMBU_PLATE", "Invalid print sequence");
  if (plate.filamentMaps !== undefined && plate.filamentMapMode === undefined)
    fail(
      "BAMBU_PLATE",
      "filamentMaps requires filamentMapMode, otherwise Studio ignores the override",
    );
  if (
    plate.filamentVolumeMaps !== undefined &&
    plate.filamentMapMode === undefined
  )
    fail("BAMBU_PLATE", "filamentVolumeMaps requires filamentMapMode");
  for (const values of [plate.filamentMaps, plate.filamentVolumeMaps])
    if (
      values !== undefined &&
      (!values.length ||
        (slotCount !== undefined && values.length !== slotCount))
    )
      fail(
        "BAMBU_PLATE",
        "Filament mapping must have one entry per project filament slot",
      );
  if (
    plate.filamentMaps?.some(
      (v) => !isPositiveId(v) || (nozzleCount !== undefined && v > nozzleCount),
    )
  )
    fail(
      "BAMBU_PLATE",
      "filamentMaps must reference 1-based physical extruders",
    );
  if (plate.filamentVolumeMaps?.some((v) => v !== 0 && v !== 1))
    fail("BAMBU_PLATE", "filamentVolumeMaps contains only 0 or 1");
  for (const values of [
    plate.firstLayerPrintSequence,
    plate.otherLayersPrintSequence,
  ])
    if (values?.some((v) => !isPositiveId(v, 0)))
      fail(
        "BAMBU_PLATE",
        "Layer sequence entries must be nonnegative integers",
      );
  if (
    plate.otherLayersPrintSequenceNums !== undefined &&
    !isPositiveId(plate.otherLayersPrintSequenceNums, 0)
  )
    fail("BAMBU_PLATE", "Invalid sequence count");
  if (plate.spiralMode !== undefined && typeof plate.spiralMode !== "boolean")
    fail("BAMBU_PLATE", "spiralMode must be boolean");
  const result: Record<string, string | number | boolean> = {
    ...plate.settings,
    plater_id: plate.id,
    locked: String(plate.locked ?? false),
  };
  if (plate.name !== undefined) result.plater_name = plate.name;
  for (const [field, key] of Object.entries(PLATE_FIELDS)) {
    const value = plate[field as keyof typeof PLATE_FIELDS];
    if (value !== undefined)
      result[key] = Array.isArray(value)
        ? value.join(" ")
        : typeof value === "boolean"
          ? String(value)
          : (value as string | number);
  }
  if (plate.thumbnail !== undefined)
    result.thumbnail_file = thumbnailPath(plate.id).slice(1);
  return result;
}
export function plateXml(
  plate: BambuPlate,
  slotCount?: number,
  nozzleCount?: number,
): string {
  return element(
    "plate",
    {},
    settingsXml(plateMetadata(plate, slotCount, nozzleCount)) +
      plate.instances
        .map((i) =>
          element(
            "model_instance",
            {},
            settingsXml({
              object_id: i.objectId,
              instance_id: i.instanceId,
              identify_id: i.identifyId,
            }),
          ),
        )
        .join(""),
  );
}
export function plateThumbnail(plate: BambuPlate): PackagePart | undefined {
  if (!plate.thumbnail) return undefined;
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (signature.some((byte, i) => plate.thumbnail![i] !== byte))
    fail("BAMBU_THUMBNAIL", "Plate thumbnail must contain PNG bytes");
  return {
    path: thumbnailPath(plate.id),
    contentType: "image/png",
    data: plate.thumbnail,
  };
}
/** Decode the supported plate metadata subset. Opaque document attachments remain untouched.
 * Unknown asset/G-code references fail explicitly instead of being lost on a rewrite.
 */
export function readBambuPlates(document: Document): readonly BambuPlate[] {
  const part = document.attachments?.find(
    (a) => pathKey(a.path) === "/metadata/model_settings.config",
  );
  if (!part) return [];
  const config = parseXml(
    new TextDecoder("utf-8", { fatal: true }).decode(part.data),
  );
  if (config.local !== "config" || config.uri)
    fail("BAMBU_CONFIG", "Expected unnamespaced config root");
  const readMetadata = (node: typeof config) => {
    const result: Record<string, string> = Object.create(null);
    for (const child of node.children.filter((c) => c.local === "metadata")) {
      checkNode(child, ["|key", "|value"], []);
      const key = requiredAttr(child, "key");
      if (Object.hasOwn(result, key))
        fail("BAMBU_CONFIG", `Duplicate metadata ${key}`);
      result[key] = requiredAttr(child, "value");
    }
    return result;
  };
  const int = (value: string | undefined, label: string, min = 0) => {
    if (
      value === undefined ||
      !/^\d+$/.test(value) ||
      !isPositiveId(Number(value), min)
    )
      fail("BAMBU_CONFIG", `Invalid ${label}`);
    return Number(value);
  };
  const bool = (value: string) => {
    if (!["true", "false", "0", "1"].includes(value))
      fail("BAMBU_CONFIG", "Invalid boolean");
    return value === "true" || value === "1";
  };
  return config.children
    .filter((c) => c.local === "plate" && c.uri === "")
    .map((node) => {
      checkNode(node, [], ["|metadata", "|model_instance"]);
      const values = readMetadata(node);
      const plate: BambuPlate = {
        id: int(values.plater_id, "plater_id", 1),
        name: values.plater_name,
        locked: values.locked === undefined ? undefined : bool(values.locked),
        instances: node.children
          .filter((c) => c.local === "model_instance")
          .map((instance) => {
            checkNode(instance, [], ["|metadata"]);
            const m = readMetadata(instance);
            for (const k of Object.keys(m))
              if (!["object_id", "instance_id", "identify_id"].includes(k))
                fail("BAMBU_CONFIG", `Unsupported instance metadata ${k}`);
            return {
              objectId: int(m.object_id, "object_id", 1),
              instanceId: int(m.instance_id, "instance_id"),
              identifyId: int(m.identify_id, "identify_id"),
            };
          }),
      };
      const mutable = plate as unknown as Record<string, unknown>;
      for (const [field, key] of Object.entries(PLATE_FIELDS)) {
        const value = values[key];
        if (value === undefined) continue;
        mutable[field] =
          field === "spiralMode"
            ? bool(value)
            : field === "otherLayersPrintSequenceNums"
              ? int(value, key)
              : [
                    "filamentMaps",
                    "filamentVolumeMaps",
                    "firstLayerPrintSequence",
                    "otherLayersPrintSequence",
                  ].includes(field)
                ? value.trim()
                  ? value
                      .trim()
                      .split(/\s+/)
                      .map((v) => int(v, key))
                  : []
                : value;
      }
      if (values.thumbnail_file) {
        const path = values.thumbnail_file.startsWith("/")
          ? values.thumbnail_file
          : "/" + values.thumbnail_file;
        const image = document.attachments?.find(
          (a) => pathKey(a.path) === pathKey(path),
        );
        if (!image || image.contentType !== "image/png")
          fail("BAMBU_THUMBNAIL", "Missing PNG plate thumbnail");
        plate.thumbnail = image.data;
      }
      for (const key of unsupportedAssetKeys)
        if (values[key])
          fail(
            "BAMBU_UNSUPPORTED",
            `Typed plate reading does not yet support ${key}; original attachment remains available`,
          );
      plate.settings = Object.fromEntries(
        Object.entries(values).filter(
          ([key]) =>
            !specialKeys.includes(key) && !unsupportedAssetKeys.includes(key),
        ),
      );
      plateMetadata(plate);
      return plate;
    });
}
