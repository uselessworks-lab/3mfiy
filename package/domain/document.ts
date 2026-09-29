import { DataSnapshot } from "./snapshot.js";
import { DEFAULT_MODEL_PATH } from "../constants.js";
import { fail } from "../errors.js";
import { withProductionUUIDs } from "../extensions/production.js";
import { read3mf, write3mf } from "../opc/package.js";
import { partPath, pathKey } from "../opc/paths.js";
import { DocumentValidator } from "../validate.js";
import type {
  Document,
  Diagnostic,
  PackagePart,
  Relationship,
  ReadOptions,
  WriteOptions,
  ValidationOptions,
} from "../model/types.js";
import { ThreeMFModel, type ModelSettings } from "./model.js";
import {
  ThreeMFBuilder,
  type Create3mfObject,
  type Create3mfOptions,
  type Create3mfResult,
} from "../model/create.js";

/** Aggregate root for authoring, inspection, validation and portable 3MF serialization. */
export class ThreeMFDocument {
  readonly #root: string;
  #models = new Map<string, ThreeMFModel>();
  #attachments = new Map<string, PackagePart>();
  #relationships: Relationship[] = [];
  constructor(rootPath = DEFAULT_MODEL_PATH, rootSettings: ModelSettings = {}) {
    partPath(rootPath);
    this.#root = rootPath;
    this.#models.set(
      pathKey(rootPath),
      new ThreeMFModel(rootPath, rootSettings),
    );
  }
  static create3mf(
    objects: readonly Create3mfObject[],
    options: Create3mfOptions = {},
  ): Create3mfResult {
    const builder = new ThreeMFBuilder(options);
    for (const object of objects) builder.addObject(object);
    return builder.build();
  }
  /** Restores owned objects from a snapshot; incomplete drafts remain representable. */
  static fromData(data: Document): ThreeMFDocument {
    const document = new ThreeMFDocument(data.root);
    document.#models.clear();
    for (const model of data.models)
      document.insertModel(ThreeMFModel.fromData(model));
    for (const part of data.attachments ?? []) document.addAttachment(part);
    document.#relationships = DataSnapshot.copy([
      ...(data.relationships ?? []),
    ]);
    return document;
  }
  static read(
    bytes: Uint8Array | ArrayBuffer,
    options: ReadOptions = {},
  ): ThreeMFDocument {
    return ThreeMFDocument.fromData(read3mf(bytes, options).document);
  }
  get rootPath(): string {
    return this.#root;
  }
  get rootModel(): ThreeMFModel {
    return (
      this.getModel(this.#root) ?? fail("ROOT_MODEL", "Missing root model")
    );
  }
  get models(): readonly ThreeMFModel[] {
    return [...this.#models.values()];
  }
  get attachments(): readonly PackagePart[] {
    return DataSnapshot.copy([...this.#attachments.values()]);
  }
  get relationships(): readonly Relationship[] {
    return DataSnapshot.copy(this.#relationships);
  }
  getModel(path: string): ThreeMFModel | undefined {
    return this.#models.get(pathKey(path));
  }
  createModel(path: string, settings: ModelSettings = {}): ThreeMFModel {
    return this.insertModel(new ThreeMFModel(path, settings));
  }
  /** Adopts a clone and returns the model owned by this document. */
  addModel(model: ThreeMFModel): ThreeMFModel {
    return this.insertModel(model.clone());
  }
  getAttachment(path: string): PackagePart | undefined {
    const part = this.#attachments.get(pathKey(path));
    return part ? DataSnapshot.copy(part) : undefined;
  }
  addAttachment(part: PackagePart): this {
    const key = pathKey(part.path);
    if (this.#models.has(key) || this.#attachments.has(key))
      fail("DUPLICATE_PART", `Part ${part.path} already exists`);
    this.#attachments.set(key, DataSnapshot.copy(part));
    return this;
  }
  replaceAttachment(part: PackagePart): this {
    const key = pathKey(part.path);
    if (!this.#attachments.has(key))
      fail("MISSING_PART", `Missing attachment ${part.path}`);
    this.#attachments.set(key, DataSnapshot.copy(part));
    return this;
  }
  addRelationship(relationship: Relationship): this {
    this.#relationships.push(DataSnapshot.copy(relationship));
    return this;
  }
  replaceRelationships(relationships: readonly Relationship[]): this {
    this.#relationships = DataSnapshot.copy([...relationships]);
    return this;
  }
  validate(options: ValidationOptions = {}): readonly Diagnostic[] {
    return new DocumentValidator(options).validate(this.toData());
  }
  assertValid(options: ValidationOptions = {}): this {
    new DocumentValidator(options).assertValid(this.toData());
    return this;
  }
  /** Returns an independent Production-enabled document; failure never changes this instance. */
  withProductionUUIDs(uuid?: () => string): ThreeMFDocument {
    const candidate = ThreeMFDocument.fromData(
      withProductionUUIDs(this.toData(), uuid),
    );
    return candidate.assertValid();
  }
  write(options: WriteOptions = {}): Uint8Array {
    return write3mf(this.toData(), options);
  }
  clone(): ThreeMFDocument {
    return ThreeMFDocument.fromData(this.toData());
  }
  /** Deep snapshot for structured-clone/Worker exchange; editing it cannot mutate this document. */
  toData(): Document {
    return {
      root: this.#root,
      models: this.models.map((m) => m.toData()),
      attachments: this.attachments,
      relationships: this.relationships,
    };
  }
  private insertModel(model: ThreeMFModel): ThreeMFModel {
    const key = pathKey(model.path);
    if (this.#models.has(key) || this.#attachments.has(key))
      fail("DUPLICATE_PART", `Part ${model.path} already exists`);
    this.#models.set(key, model);
    return model;
  }
}
