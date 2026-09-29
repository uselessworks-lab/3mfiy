import { DataSnapshot } from "../../domain/snapshot.js";
import { ThreeMFDocument } from "../../domain/document.js";
import { fail } from "../../errors.js";
import type { WriteOptions } from "../../model/types.js";
import {
  createBambuProjectSettings,
  filamentSlotCount,
  presetIdentity,
  readBambuProfiles,
} from "./profiles.js";
import { readBambuPlates } from "./plates.js";
import { withBambuProject } from "./project.js";
import type {
  BambuProjectSettings,
  BambuFilamentSlot,
  BambuEmbeddedPreset,
  BambuPlate as PlateData,
  BambuInstance,
  BambuObjectSettings,
  BambuAssemblyItem,
} from "./types.js";

/** Owns serialized project settings. Configuration edits are validated before commit. */
export class BambuProfile {
  #settings: BambuProjectSettings;
  constructor(settings: BambuProjectSettings) {
    filamentSlotCount(settings);
    this.#settings = DataSnapshot.copy(settings);
  }
  static fromFilaments(filaments: readonly BambuFilamentSlot[]): BambuProfile {
    return new BambuProfile(createBambuProjectSettings({ filaments }));
  }
  setFilaments(filaments: readonly BambuFilamentSlot[]): this {
    const candidate = createBambuProjectSettings({
      base: this.#settings,
      filaments,
    });
    this.#settings = DataSnapshot.copy(candidate);
    return this;
  }
  setOptions(options: BambuProjectSettings): this {
    const candidate = { ...this.#settings, ...DataSnapshot.copy(options) };
    filamentSlotCount(candidate);
    this.#settings = candidate;
    return this;
  }
  toData(): BambuProjectSettings {
    return DataSnapshot.copy(this.#settings);
  }
  clone(): BambuProfile {
    return new BambuProfile(this.#settings);
  }
}
/** Immutable preset value. Authoring additionally requires an installed inherits parent at write time. */
export class BambuPreset {
  readonly #data: BambuEmbeddedPreset;
  constructor(
    kind: BambuEmbeddedPreset["kind"],
    config: BambuEmbeddedPreset["config"],
  ) {
    const data = { kind, config };
    presetIdentity(data);
    this.#data = DataSnapshot.copy(data);
  }
  get kind(): BambuEmbeddedPreset["kind"] {
    return this.#data.kind;
  }
  get name(): string {
    return presetIdentity(this.#data);
  }
  toData(): BambuEmbeddedPreset {
    return DataSnapshot.copy(this.#data);
  }
  clone(): BambuPreset {
    return new BambuPreset(this.kind, this.#data.config);
  }
}
export type BambuPlateSettings = Omit<PlateData, "id" | "instances">;
/** Owns a plate's options and instance assignments. The ID is immutable. */
export class BambuPlate {
  readonly #id: number;
  #settings: BambuPlateSettings;
  #instances: BambuInstance[] = [];
  constructor(id: number, settings: BambuPlateSettings = {}) {
    if (!Number.isInteger(id) || id < 1 || id >= 2147483648)
      fail("BAMBU_PLATE", "Plate ID must be a positive 31-bit integer");
    this.#id = id;
    this.#settings = DataSnapshot.copy(settings);
  }
  static fromData(data: PlateData): BambuPlate {
    const { id, instances, ...settings } = data;
    const plate = new BambuPlate(id, settings);
    plate.#instances = DataSnapshot.copy([...instances]);
    return plate;
  }
  get id(): number {
    return this.#id;
  }
  get name(): string | undefined {
    return this.#settings.name;
  }
  get instances(): readonly BambuInstance[] {
    return DataSnapshot.copy(this.#instances);
  }
  configure(settings: BambuPlateSettings): this {
    this.#settings = { ...this.#settings, ...DataSnapshot.copy(settings) };
    return this;
  }
  addInstance(instance: BambuInstance): this {
    this.#instances.push(DataSnapshot.copy(instance));
    return this;
  }
  replaceInstances(instances: readonly BambuInstance[]): this {
    this.#instances = DataSnapshot.copy([...instances]);
    return this;
  }
  removeInstance(objectId: number, instanceId: number): boolean {
    const before = this.#instances.length;
    this.#instances = this.#instances.filter(
      (i) => i.objectId !== objectId || i.instanceId !== instanceId,
    );
    return this.#instances.length !== before;
  }
  toData(): PlateData {
    return {
      ...DataSnapshot.copy(this.#settings),
      id: this.#id,
      instances: this.instances,
    };
  }
  clone(): BambuPlate {
    return BambuPlate.fromData(this.toData());
  }
}
/** Read-only inspection deliberately has no write method: unsupported config cannot be silently rebuilt. */
export class BambuProjectInspection {
  readonly #profiles: ReturnType<typeof readBambuProfiles>;
  readonly #document: ThreeMFDocument;
  constructor(document: ThreeMFDocument) {
    this.#document = document.clone();
    this.#profiles = readBambuProfiles(this.#document.toData());
  }
  get profile(): BambuProfile | undefined {
    return this.#profiles.projectSettings
      ? new BambuProfile(this.#profiles.projectSettings)
      : undefined;
  }
  get presets(): readonly BambuPreset[] {
    return this.#profiles.embeddedPresets.map(
      (p) => new BambuPreset(p.kind, p.config),
    );
  }
  get plates(): readonly BambuPlate[] {
    return readBambuPlates(this.#document.toData()).map((p) =>
      BambuPlate.fromData(p),
    );
  }
}
export interface BambuStudioProjectOptions {
  applicationVersion: string;
  profile: BambuProfile;
}
/** Authoring aggregate. Owns a document clone and regenerates configuration from current objects at each write. */
export class BambuStudioProject {
  readonly #document: ThreeMFDocument;
  readonly #profile: BambuProfile;
  readonly #applicationVersion: string;
  readonly #plates = new Map<number, BambuPlate>();
  readonly #objects = new Map<number, BambuObjectSettings>();
  #presets: BambuPreset[] | undefined;
  #assembly: readonly BambuAssemblyItem[] | undefined;
  constructor(document: ThreeMFDocument, options: BambuStudioProjectOptions) {
    this.#document = document.clone();
    this.#profile = options.profile.clone();
    this.#applicationVersion = options.applicationVersion;
  }
  static inspect(document: ThreeMFDocument): BambuProjectInspection {
    return new BambuProjectInspection(document);
  }
  /** Live owned instances: use their methods to edit this project. */
  get document(): ThreeMFDocument {
    return this.#document;
  }
  get profile(): BambuProfile {
    return this.#profile;
  }
  get plates(): readonly BambuPlate[] {
    return [...this.#plates.values()];
  }
  addPlate(plate: BambuPlate): BambuPlate {
    if (this.#plates.has(plate.id))
      fail("BAMBU_PLATE", `Plate ${plate.id} already exists`);
    const owned = plate.clone();
    this.#plates.set(owned.id, owned);
    return owned;
  }
  setObjectSettings(settings: BambuObjectSettings): this {
    this.#objects.set(settings.objectId, DataSnapshot.copy(settings));
    return this;
  }
  setAssembly(assembly: readonly BambuAssemblyItem[]): this {
    this.#assembly = DataSnapshot.copy(assembly);
    return this;
  }
  /** Replaces modern embedded presets; [] removes them. No call preserves the original files. */
  setPresets(presets: readonly BambuPreset[]): this {
    this.#presets = presets.map((p) => p.clone());
    return this;
  }
  toDocument(): ThreeMFDocument {
    const data = withBambuProject(this.#document.toData(), {
      applicationVersion: this.#applicationVersion,
      projectSettings: this.#profile.toData(),
      objects: [...this.#objects.values()],
      plates: this.plates.map((p) => p.toData()),
      embeddedPresets: this.#presets?.map((p) => p.toData()),
      assembly: this.#assembly,
    });
    return ThreeMFDocument.fromData(data);
  }
  write(options: WriteOptions = {}): Uint8Array {
    return this.toDocument().write(options);
  }
}
