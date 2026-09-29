import { strToU8 } from "fflate";
import { fail } from "../../errors.js";
import type { Document, PackagePart } from "../../model/types.js";
import type {
  BambuConfig,
  BambuEmbeddedPreset,
  BambuFilamentSlot,
  BambuProjectSettings,
} from "./types.js";
export const PRESET_PREFIX = {
  process: "process_settings_",
  filament: "filament_settings_",
  machine: "machine_settings_",
} as const;
export function isPresetPath(path: string): boolean {
  return /^\/Metadata\/(process_settings_|filament_settings_|machine_settings_)\d+\.config$/i.test(
    path,
  );
}
export function validateConfig(
  value: unknown,
  label = "profile",
): asserts value is BambuConfig {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("BAMBU_PROFILE", `${label} must be a serialized configuration object`);
  for (const [key, v] of Object.entries(value))
    if (
      !key ||
      !(
        typeof v === "string" ||
        (Array.isArray(v) && v.every((i) => typeof i === "string"))
      )
    )
      fail(
        "BAMBU_PROFILE",
        `${label}.${key} must be a string or string[] (serialize numbers and booleans)`,
      );
}
export function filamentSlotCount(
  settings: BambuProjectSettings,
): number | undefined {
  validateConfig(settings);
  const names = settings.filament_settings_id,
    colors = settings.filament_colour;
  for (const [label, values] of Object.entries({
    filament_settings_id: names,
    filament_colour: colors,
    filament_type: settings.filament_type,
    filament_ids: settings.filament_ids,
  }))
    if (values !== undefined && (!Array.isArray(values) || !values.length))
      fail("BAMBU_FILAMENT", `${label} must be a nonempty string array`);
  const count = names?.length ?? colors?.length;
  for (const [label, values] of Object.entries({
    filament_colour: colors,
    filament_type: settings.filament_type,
    filament_ids: settings.filament_ids,
  }))
    if (values && count !== undefined && values.length !== count)
      fail(
        "BAMBU_FILAMENT",
        `${label} must match the project filament slot count`,
      );
  if (names?.some((name) => !name.trim()))
    fail("BAMBU_FILAMENT", "Filament preset IDs cannot be empty");
  if (colors?.some((c) => !/^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(c)))
    fail("BAMBU_FILAMENT", "Filament colors must be #RRGGBB or #RRGGBBAA");
  for (const key of ["printer_settings_id", "print_settings_id"] as const)
    if (
      settings[key] !== undefined &&
      (typeof settings[key] !== "string" || !settings[key]!.trim())
    )
      fail("BAMBU_PROFILE", `${key} must be a nonempty string`);
  if (
    settings.nozzle_diameter !== undefined &&
    (!Array.isArray(settings.nozzle_diameter) ||
      !settings.nozzle_diameter.length ||
      settings.nozzle_diameter.some(
        (v) => !v.trim() || !Number.isFinite(Number(v)) || Number(v) <= 0,
      ))
  )
    fail(
      "BAMBU_PROFILE",
      "nozzle_diameter must contain positive serialized numbers",
    );
  const self = settings.filament_self_index,
    variants = settings.filament_extruder_variant;
  if (
    self !== undefined &&
    (!Array.isArray(self) ||
      self.some(
        (v) =>
          !/^\d+$/.test(v) ||
          Number(v) < 1 ||
          (count !== undefined && Number(v) > count),
      ))
  )
    fail(
      "BAMBU_FILAMENT",
      "filament_self_index contains invalid 1-based project slots",
    );
  if (
    variants !== undefined &&
    (!Array.isArray(variants) ||
      (self !== undefined && variants.length !== self.length) ||
      (count !== undefined && variants.length < count))
  )
    fail(
      "BAMBU_FILAMENT",
      "Variant and self-index vectors must align without collapsing to the filament count",
    );
  // Tool/material-dependent arrays are deliberately not resized to N or N².
  return count;
}
/** Replace aligned slot identity/color arrays while preserving unrelated multi-tool profile data.
 * Slot count changes with an existing filament profile are rejected: provide a resized base explicitly.
 */
export function createBambuProjectSettings(options: {
  base?: BambuProjectSettings;
  printerSettingsId?: string;
  printSettingsId?: string;
  filaments: readonly BambuFilamentSlot[];
}): BambuProjectSettings {
  const base = options.base ?? {};
  const oldCount = filamentSlotCount(base);
  if (!options.filaments.length)
    fail("BAMBU_FILAMENT", "At least one filament slot is required");
  if (oldCount !== undefined && oldCount !== options.filaments.length)
    fail(
      "BAMBU_FILAMENT",
      "Changing slot count requires a caller-resized base profile",
    );
  const extra: Record<string, string | readonly string[]> = {};
  for (const [field, key] of [
    ["type", "filament_type"],
    ["filamentId", "filament_ids"],
  ] as const) {
    const values = options.filaments.map((s) => s[field]);
    if (values.some((v) => v !== undefined)) {
      if (values.some((v) => v === undefined))
        fail("BAMBU_FILAMENT", `Provide ${field} for every slot or none`);
      extra[key] = values as string[];
    }
  }
  const result: BambuProjectSettings = {
    ...base,
    ...extra,
    ...(options.printerSettingsId === undefined
      ? {}
      : { printer_settings_id: options.printerSettingsId }),
    ...(options.printSettingsId === undefined
      ? {}
      : { print_settings_id: options.printSettingsId }),
    filament_settings_id: options.filaments.map((f) => f.settingsId),
    filament_colour: options.filaments.map((f) => f.color),
  };
  // A slot can contain multiple space-separated colors. Only update a matching
  // old single-color value; preserve multi-color and independently chosen values.
  filamentSlotCount(result);
  if (base.filament_multi_colour !== undefined) {
    if (
      !Array.isArray(base.filament_multi_colour) ||
      base.filament_multi_colour.length !== options.filaments.length
    )
      fail(
        "BAMBU_FILAMENT",
        "filament_multi_colour is not a one-entry-per-slot vector",
      );
    return {
      ...result,
      filament_multi_colour: base.filament_multi_colour.map((value, i) =>
        value === base.filament_colour?.[i]
          ? result.filament_colour![i]!
          : value,
      ),
    };
  }
  return result;
}
export function presetIdentity(preset: BambuEmbeddedPreset): string {
  validateConfig(preset.config, "embedded preset");
  const key =
    preset.kind === "filament"
      ? "filament_settings_id"
      : preset.kind === "process"
        ? "print_settings_id"
        : preset.kind === "machine"
          ? "printer_settings_id"
          : fail("BAMBU_PRESET", "Unknown preset kind");
  const value = preset.config[key];
  if (
    preset.kind === "filament"
      ? !Array.isArray(value) || value.length !== 1 || !value[0]?.trim()
      : typeof value !== "string" || !value.trim()
  )
    fail(
      "BAMBU_PRESET",
      `Embedded ${preset.kind} preset requires ${key}${preset.kind === "filament" ? " with exactly one name" : ""}`,
    );
  const name = typeof value === "string" ? value : value![0]!;
  if (
    preset.config.name !== name ||
    preset.config.from !== "project" ||
    typeof preset.config.version !== "string" ||
    !preset.config.version.trim()
  )
    fail(
      "BAMBU_PRESET",
      'Embedded presets require matching name, from="project", and a version',
    );
  if (
    preset.config.inherits !== undefined &&
    typeof preset.config.inherits !== "string"
  )
    fail("BAMBU_PRESET", "Preset inherits must be a serialized parent name");
  return name;
}
export function presetParts(
  presets: readonly BambuEmbeddedPreset[],
): PackagePart[] {
  const count = { process: 0, filament: 0, machine: 0 },
    seen = new Set<string>();
  return presets.map((p) => {
    const name = presetIdentity(p),
      key = p.kind + ":" + name;
    if (typeof p.config.inherits !== "string" || !p.config.inherits.trim())
      fail(
        "BAMBU_PRESET",
        "Embedded presets require a nonempty inherits parent installed in Studio",
      );
    if (seen.has(key)) fail("BAMBU_PRESET", `Duplicate embedded preset ${key}`);
    seen.add(key);
    return {
      path: `/Metadata/${PRESET_PREFIX[p.kind]}${++count[p.kind]}.config`,
      contentType: "application/json",
      data: strToU8(JSON.stringify(p.config)),
    };
  });
}
/** Read serialized profile data without changing vendor-specific keys or multi-tool array shapes. */
export function readBambuProfiles(document: Document): {
  projectSettings?: BambuProjectSettings;
  embeddedPresets: readonly BambuEmbeddedPreset[];
} {
  let projectSettings: BambuProjectSettings | undefined;
  const embeddedPresets: BambuEmbeddedPreset[] = [];
  for (const part of document.attachments ?? []) {
    const project =
      part.path.toLowerCase() === "/metadata/project_settings.config";
    if (!project && !isPresetPath(part.path)) continue;
    let config: unknown;
    try {
      config = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(part.data),
      );
    } catch {
      fail("BAMBU_PROFILE", `Invalid JSON profile ${part.path}`);
    }
    validateConfig(config, part.path);
    if (project) {
      projectSettings = config as BambuProjectSettings;
      filamentSlotCount(projectSettings);
    } else {
      const kind = (
        Object.keys(PRESET_PREFIX) as (keyof typeof PRESET_PREFIX)[]
      ).find((k) => part.path.toLowerCase().includes("/" + PRESET_PREFIX[k]))!;
      const preset = { kind, config };
      presetIdentity(preset);
      embeddedPresets.push(preset);
    }
  }
  return { projectSettings, embeddedPresets };
}
