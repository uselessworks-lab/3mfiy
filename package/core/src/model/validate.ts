import {
  ThreeMFUnit,
  ThreeMFObjectType,
  TextureTileStyle,
  TextureFilter,
  BlendMethod,
} from "./enums.js";
import { NS } from "../constants.js";
import { propertyCount } from "../extensions/materials.js";
import { usesProduction } from "../extensions/production.js";
import { pathKey } from "../opc/paths.js";
import type {
  Diagnostic,
  Document,
  Metadata,
  Mesh,
  MeshObject,
  Model,
  ObjectReference,
  ObjectResource,
  Resource,
  Transform,
  ValidationOptions,
} from "./types.js";
const integer = (n: number, min = 0) =>
  Number.isInteger(n) && n >= min && n < 2147483648;
const color = (s: string) => /^#[\da-f]{6}([\da-f]{2})?$/i.test(s);
const uuidPattern =
  /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const metadataNames = new Set([
  "Title",
  "Designer",
  "Description",
  "Copyright",
  "LicenseTerms",
  "Rating",
  "CreationDate",
  "ModificationDate",
  "Application",
]);

/** One validation run owns its lookup indexes, diagnostics and component graph. */
export class ModelValidator {
  private readonly diagnostics: Diagnostic[] = [];
  private readonly models = new Map<string, Model>();
  private readonly resourceMaps = new Map<Model, Map<number, Resource>>();
  private readonly uuids = new Set<string>();
  private readonly graph = new Map<ObjectResource, ObjectResource[]>();
  private root: Model | undefined;
  constructor(
    private readonly doc: Document,
    private readonly options: ValidationOptions = {},
  ) {}
  validate(): Diagnostic[] {
    this.diagnostics.length = 0;
    this.models.clear();
    this.resourceMaps.clear();
    this.uuids.clear();
    this.graph.clear();
    this.root = undefined;
    const parts = new Map<string, string>();
    for (const part of [...this.doc.models, ...(this.doc.attachments ?? [])]) {
      const key = this.safePath(part.path);
      if (key) {
        if (parts.has(key))
          this.error(
            "DUPLICATE_PART",
            part.path,
            "Part paths must be unique (case insensitive)",
          );
        parts.set(key, part.path);
      }
    }
    for (const model of this.doc.models) {
      const key = this.safePath(model.path);
      if (key) this.models.set(key, model);
      this.resourceMaps.set(
        model,
        new Map(model.resources.map((r) => [r.id, r])),
      );
    }
    const rootKey = this.safePath(this.doc.root);
    this.root = rootKey ? this.models.get(rootKey) : undefined;
    if (!this.root)
      this.error(
        "ROOT_MODEL",
        this.doc.root,
        "Root must identify a model part",
      );
    if (this.root && !this.root.build.length)
      this.error(
        "EMPTY_BUILD",
        this.root.path,
        "Root model must contain at least one build item",
      );
    for (const model of this.doc.models) this.validateModel(model);
    this.validateCycles();
    for (const attachment of this.doc.attachments ?? []) {
      if (!attachment.contentType || /[\r\n]/.test(attachment.contentType))
        this.error(
          "CONTENT_TYPE",
          attachment.path,
          "Attachment needs a valid content type",
        );
    }
    return this.diagnostics;
  }
  private error(code: string, path: string, message: string): void {
    this.diagnostics.push({ severity: "error", code, path, message });
  }
  private warning(code: string, path: string, message: string): void {
    this.diagnostics.push({ severity: "warning", code, path, message });
  }
  private safePath(path: string): string | undefined {
    try {
      return pathKey(path);
    } catch (e) {
      this.error("PART_PATH", path, String(e));
      return undefined;
    }
  }
  private checkUuid(
    value: string | undefined,
    path: string,
    required: boolean,
  ) {
    if (value === undefined) {
      if (required)
        this.error(
          "UUID_REQUIRED",
          path,
          "Production UUID is required; use withProductionUUIDs",
        );
      return;
    }
    if (!uuidPattern.test(value)) this.error("UUID", path, "Invalid UUID");
    if (this.uuids.has(value.toLowerCase()))
      this.error("DUPLICATE_UUID", path, "Production UUIDs must be unique");
    this.uuids.add(value.toLowerCase());
  }
  private checkTransform(t: Transform | undefined, path: string) {
    if (t === undefined) return;
    if (t.length !== 12 || t.some((n) => !Number.isFinite(n))) {
      this.error("TRANSFORM", path, "Transform must contain 12 finite numbers");
      return;
    }
    const det =
      t[0] * (t[4] * t[8] - t[5] * t[7]) -
      t[1] * (t[3] * t[8] - t[5] * t[6]) +
      t[2] * (t[3] * t[7] - t[4] * t[6]);
    if (det === 0 || !Number.isFinite(det))
      this.error("TRANSFORM", path, "Transform must be invertible");
  }
  private checkMetadata(
    list: readonly Metadata[] | undefined,
    model: Model,
    path: string,
  ) {
    const names = new Set<string>();
    for (const m of list ?? []) {
      const segments = m.name.split(":");
      if (
        segments.length === 1
          ? !metadataNames.has(m.name)
          : segments.length !== 2 ||
            !model.namespaces?.[segments[0]!] ||
            !/^[A-Za-z_][\w.-]*$/.test(segments[0]!) ||
            !/^[\w.-]+$/.test(segments[1]!)
      )
        this.error(
          "METADATA_NAME",
          path,
          `Unknown or undeclared metadata name ${m.name}`,
        );
      if (names.has(m.name))
        this.error("METADATA_DUPLICATE", path, `Duplicate metadata ${m.name}`);
      names.add(m.name);
    }
  }
  private checkAttachment(path: string, type: string | undefined, at: string) {
    const key = this.safePath(path);
    const attachment = this.doc.attachments?.find(
      (a) => safeKey(a.path) === key,
    );
    if (!attachment)
      this.error("MISSING_PART", at, `Missing attachment ${path}`);
    else if (type && attachment.contentType !== type)
      this.error("CONTENT_TYPE", at, `Attachment ${path} must be ${type}`);
  }
  private target(
    ref: ObjectReference,
    model: Model,
    at: string,
    owner?: ObjectResource,
  ) {
    this.checkTransform(ref.transform, at);
    this.checkUuid(ref.uuid, at, usesProduction(model));
    if (!integer(ref.objectId, 1))
      this.error(
        "RESOURCE_ID",
        at,
        "Object reference must be a positive 31-bit integer",
      );
    if (ref.path !== undefined && model !== this.root)
      this.error(
        "PRODUCTION_PATH",
        at,
        "Only root model references may have a production path",
      );
    const tm =
      ref.path !== undefined
        ? this.models.get(this.safePath(ref.path) ?? "")
        : model;
    const resource = tm && this.resourceMaps.get(tm)?.get(ref.objectId);
    if (!resource || resource.kind !== "object") {
      this.error(
        "OBJECT_REFERENCE",
        at,
        `Missing object ${ref.objectId} in ${ref.path ?? model.path}`,
      );
      return undefined;
    }
    if (
      owner &&
      tm === model &&
      model.resources.indexOf(resource) >= model.resources.indexOf(owner)
    )
      this.error(
        "RESOURCE_ORDER",
        at,
        "Component objects must be defined before references",
      );
    return resource;
  }
  private validateModel(model: Model): void {
    const at = model.path,
      map = this.resourceMaps.get(model)!;
    const production = usesProduction(model);
    if (model.unit && !Object.values<string>(ThreeMFUnit).includes(model.unit))
      this.error("UNIT", at, "Invalid model unit");
    for (const [prefix, uri] of Object.entries(model.namespaces ?? {}))
      if (!/^[A-Za-z_][\w.-]*$/.test(prefix) || /^xml/i.test(prefix) || !uri)
        this.error("NAMESPACE", at, `Invalid namespace prefix ${prefix}`);
    const inferredRequired = new Set(model.requiredExtensions ?? []);
    if (production) inferredRequired.add(NS.production);
    if (
      model.resources.some(
        (r) => r.kind !== "object" && r.kind !== "baseMaterials",
      )
    )
      inferredRequired.add(NS.materials);
    for (const uri of model.requiredExtensions ?? [])
      if (uri !== NS.materials && uri !== NS.production)
        this.error(
          "UNSUPPORTED_EXTENSION",
          at,
          `Unsupported required extension ${uri}`,
        );
    for (const uri of model.recommendedExtensions ?? []) {
      if (inferredRequired.has(uri))
        this.error(
          "EXTENSION_CONFLICT",
          at,
          `Extension is both required and recommended: ${uri}`,
        );
      else if (uri !== NS.materials && uri !== NS.production)
        this.warning(
          "UNSUPPORTED_RECOMMENDED_EXTENSION",
          at,
          `Recommended extension not implemented: ${uri}`,
        );
    }
    this.checkMetadata(model.metadata, model, at);
    this.checkUuid(model.buildUuid, at, production && model === this.root);
    if (model !== this.root && model.build.length)
      this.warning(
        "CHILD_BUILD_IGNORED",
        at,
        "Only root build items are manufactured",
      );
    const ids = new Set<number>();
    const property = (pid: number, index: number, path: string) => {
      const r = map.get(pid),
        count = r && propertyCount(r);
      if (!integer(pid, 1) || count === undefined) {
        this.error("PROPERTY_REFERENCE", path, `Missing property group ${pid}`);
        return undefined;
      }
      if (!integer(index) || index >= count)
        this.error(
          "PROPERTY_INDEX",
          path,
          `Property index ${index} is out of range for ${pid}`,
        );
      return r;
    };
    for (const r of model.resources)
      this.validateResource(r, model, ids, map, property, production);
    model.build.forEach((item, i) => {
      const at = `${model.path}/build/${i}`;
      this.checkMetadata(item.metadata, model, at);
      const r = this.target(item, model, at);
      if (r && model === this.root) {
        const pending = [r],
          seen = new Set<ObjectResource>();
        while (pending.length) {
          const obj = pending.pop()!;
          if (seen.has(obj)) continue;
          seen.add(obj);
          if (!obj.components && obj.type === "other")
            this.error(
              "BUILD_OBJECT_TYPE",
              at,
              "Build cannot reference objects of type other",
            );
          if (obj.components) {
            const owner = this.doc.models.find((m) =>
              m.resources.includes(obj),
            )!;
            for (const c of obj.components) {
              const tm = c.path ? this.models.get(safeKey(c.path)) : owner;
              const child = tm && this.resourceMaps.get(tm)?.get(c.objectId);
              if (child?.kind === "object") pending.push(child);
            }
          }
        }
      }
    });
  }
  private validateResource(
    r: Resource,
    model: Model,
    ids: Set<number>,
    map: Map<number, Resource>,
    property: PropertyLookup,
    production: boolean,
  ): void {
    const at = model.path;

    const rp = `${at}#${r.id}`;
    if (!integer(r.id, 1))
      this.error(
        "RESOURCE_ID",
        rp,
        "Resource ID must be a positive 31-bit integer",
      );
    if (ids.has(r.id))
      this.error(
        "DUPLICATE_RESOURCE",
        rp,
        "Resource IDs must be unique within a model",
      );
    ids.add(r.id);
    const count = propertyCount(r);
    if (count !== undefined && (!count || count >= 2147483648))
      this.error(
        "EMPTY_PROPERTIES",
        rp,
        "Property groups need 1..2^31-1 entries",
      );
    const referencedIds: number[] = [];
    if (r.kind === "object" && r.mesh) {
      if (r.property) referencedIds.push(r.property.pid);
      for (const p of r.mesh.properties ?? [])
        if (p?.pid !== undefined) referencedIds.push(p.pid);
    } else if (r.kind === "texture2dGroup") referencedIds.push(r.textureId);
    else if (r.kind === "compositeMaterials") referencedIds.push(r.materialId);
    else if (r.kind === "multiProperties") referencedIds.push(...r.propertyIds);
    for (const id of new Set(referencedIds))
      if (id === r.id || !ids.has(id))
        this.error(
          "RESOURCE_ORDER",
          rp,
          `Resource ${id} must be declared before its reference`,
        );
    switch (r.kind) {
      case "baseMaterials":
        for (const b of r.bases)
          if (!color(b.displayColor))
            this.error("COLOR", rp, "Expected #RRGGBB or #RRGGBBAA");
        break;
      case "colorGroup":
        for (const c of r.colors)
          if (!color(c))
            this.error("COLOR", rp, "Expected #RRGGBB or #RRGGBBAA");
        break;
      case "texture2d":
        if (!["image/png", "image/jpeg"].includes(r.contentType))
          this.error("TEXTURE_TYPE", rp, "3MF textures must be PNG or JPEG");
        this.checkAttachment(r.path, r.contentType, rp);
        for (const style of [r.tileStyleU, r.tileStyleV])
          if (style && !Object.values<string>(TextureTileStyle).includes(style))
            this.error("TEXTURE_STYLE", rp, "Invalid tile style");
        if (
          r.filter &&
          !Object.values<string>(TextureFilter).includes(r.filter)
        )
          this.error("TEXTURE_FILTER", rp, "Invalid texture filter");
        break;
      case "texture2dGroup":
        if (map.get(r.textureId)?.kind !== "texture2d")
          this.error("TEXTURE_REFERENCE", rp, "Missing texture2d resource");
        if (
          r.coordinates.some(
            (c) => !Number.isFinite(c.u) || !Number.isFinite(c.v),
          )
        )
          this.error(
            "TEXTURE_COORDINATE",
            rp,
            "Texture coordinates must be finite",
          );
        break;
      case "compositeMaterials":
        if (map.get(r.materialId)?.kind !== "baseMaterials")
          this.error(
            "MATERIAL_REFERENCE",
            rp,
            "Composite must reference base materials",
          );
        if (
          r.materialIndices.length < 2 ||
          new Set(r.materialIndices).size !== r.materialIndices.length
        )
          this.error(
            "COMPOSITE_INDICES",
            rp,
            "Composite needs at least two distinct material indices",
          );
        r.materialIndices.forEach((i) => property(r.materialId, i, rp));
        for (const row of r.composites)
          if (row.some((v) => !Number.isFinite(v) || v < 0 || v > 1))
            this.error(
              "COMPOSITE_VALUES",
              rp,
              "Composite weights must be finite values in [0, 1]",
            );
        break;
      case "multiProperties": {
        if (!r.propertyIds.length)
          this.error(
            "MULTI_PROPERTIES",
            rp,
            "Multiproperties needs property IDs",
          );
        let materials = 0,
          colors = 0;
        r.propertyIds.forEach((pid, i) => {
          const pr = map.get(pid);
          if (
            !pr ||
            propertyCount(pr) === undefined ||
            pr.kind === "multiProperties"
          )
            this.error(
              "MULTI_REFERENCE",
              rp,
              "Multiproperties cannot reference itself, other multiproperties or non-properties",
            );
          if (
            pr?.kind === "baseMaterials" ||
            pr?.kind === "compositeMaterials"
          ) {
            materials++;
            if (i !== 0)
              this.error("MULTI_ORDER", rp, "Material must be the first layer");
          }
          if (pr?.kind === "colorGroup") colors++;
        });
        if (materials > 1 || colors > 1)
          this.error(
            "MULTI_PROPERTIES",
            rp,
            "At most one material and one color group per multiproperties",
          );
        if (
          (r.blendMethods?.length ?? 0) > r.propertyIds.length - 1 ||
          r.blendMethods?.some(
            (b) => !Object.values<string>(BlendMethod).includes(b),
          )
        )
          this.error("MULTI_BLEND", rp, "Invalid blend methods");
        for (const row of r.properties) {
          if (row.some((i) => !integer(i)))
            this.error(
              "PROPERTY_INDEX",
              rp,
              "Multiproperties indices must be nonnegative integers",
            );
          r.propertyIds.forEach((pid, i) => property(pid, row[i] ?? 0, rp));
        }
        break;
      }
      case "object":
        this.validateObject(r, model, property, rp, production);
        break;
      default:
        this.error("UNSUPPORTED_RESOURCE", rp, "Unimplemented resource kind");
    }
  }
  private validateObject(
    r: ObjectResource,
    model: Model,
    property: PropertyLookup,
    rp: string,
    production: boolean,
  ): void {
    this.checkUuid(r.uuid, rp, production);
    this.checkMetadata(r.metadata, model, rp);
    if (r.type && !Object.values<string>(ThreeMFObjectType).includes(r.type))
      this.error("OBJECT_TYPE", rp, "Invalid object type");
    if (r.thumbnail) this.checkAttachment(r.thumbnail, undefined, rp);
    if (r.components) {
      if (r.mesh || r.property)
        this.error(
          "OBJECT_SHAPE",
          rp,
          "Components object cannot have mesh or properties",
        );
      if (!r.components.length)
        this.error("EMPTY_COMPONENTS", rp, "Object must have components");
      this.graph.set(
        r,
        r.components
          .map((c, i) => this.target(c, model, `${rp}/components/${i}`, r))
          .filter((v): v is ObjectResource => !!v),
      );
    } else if (r.mesh) {
      this.validateMesh(r, property, rp);
    } else this.error("OBJECT_SHAPE", rp, "Object needs a mesh or components");
  }
  private validateMesh(
    r: MeshObject,
    property: PropertyLookup,
    rp: string,
  ): void {
    const mesh = r.mesh,
      n = mesh.positions.length / 3;
    if (
      !mesh.positions.length ||
      mesh.positions.length % 3 ||
      n >= 2147483648 ||
      !mesh.indices.length ||
      mesh.indices.length % 3 ||
      mesh.indices.length / 3 >= 2147483648
    )
      this.error(
        "MESH_LENGTH",
        rp,
        "Mesh buffers must contain complete vertex and triangle triples",
      );
    if ((r.type ?? "model") === "model" && mesh.indices.length < 12)
      this.error(
        "MESH_SOLID",
        rp,
        "Model meshes require at least four triangles",
      );
    if (Array.from(mesh.positions).some((v) => !Number.isFinite(v)))
      this.error("VERTEX", rp, "Vertex coordinates must be finite");
    let validIndices = true;
    for (const index of mesh.indices)
      if (!integer(index) || index >= n) {
        validIndices = false;
        this.error(
          "VERTEX_INDEX",
          rp,
          "Triangle index is outside the vertex buffer",
        );
        break;
      }
    if (mesh.properties && mesh.properties.length !== mesh.indices.length / 3)
      this.error(
        "TRIANGLE_PROPERTIES",
        rp,
        "Triangle properties array must align with triangles",
      );
    if (r.property) property(r.property.pid, r.property.index, rp);
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const a = mesh.indices[i],
        b = mesh.indices[i + 1],
        c = mesh.indices[i + 2];
      if (a === b || a === c || b === c)
        this.error(
          "DEGENERATE_TRIANGLE",
          `${rp}/triangles/${i / 3}`,
          "Triangle indices must be distinct",
        );
      const p = mesh.properties?.[i / 3];
      if (!p) continue;
      if (!r.property) {
        this.error(
          "PROPERTY_DEFAULT",
          rp,
          "Object needs a default property when triangle properties are assigned",
        );
        continue;
      }
      if (p.pid !== undefined && p.p1 === undefined)
        this.error("PROPERTY_INDEX", rp, "Triangle pid override requires p1");
      const pid = p.pid ?? r.property.pid,
        p1 = p.p1 ?? r.property.index,
        p2 = p.p2 ?? p1,
        p3 = p.p3 ?? p1;
      const pr = property(pid, p1, rp);
      property(pid, p2, rp);
      property(pid, p3, rp);
      if (pr?.kind === "baseMaterials" && (p1 !== p2 || p1 !== p3))
        this.error(
          "MATERIAL_GRADIENT",
          rp,
          "Base materials cannot have per-vertex gradients",
        );
    }
    if (
      this.options.topology &&
      validIndices &&
      mesh.indices.length % 3 === 0 &&
      ["model", "solidsupport"].includes(r.type ?? "model")
    )
      this.validateTopology(mesh, rp);
    this.graph.set(r, []);
  }
  private validateTopology(mesh: Mesh, rp: string): void {
    const edges = new Map<string, { count: number; balance: number }>();
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const t = [mesh.indices[i]!, mesh.indices[i + 1]!, mesh.indices[i + 2]!];
      for (let j = 0; j < 3; j++) {
        const a = t[j]!,
          b = t[(j + 1) % 3]!,
          key = a < b ? `${a}:${b}` : `${b}:${a}`;
        const edge = edges.get(key) ?? { count: 0, balance: 0 };
        edge.count++;
        edge.balance += a < b ? 1 : -1;
        edges.set(key, edge);
      }
    }
    if ([...edges.values()].some((e) => e.count !== 2 || e.balance !== 0))
      this.error(
        "MESH_TOPOLOGY",
        rp,
        "Solid mesh must have two oppositely oriented faces per edge",
      );
  }
  /** Iterative DFS avoids stack overflow on deeply nested component graphs. */
  private validateCycles(): void {
    const state = new Map<ObjectResource, number>();
    for (const obj of this.graph.keys()) {
      if (state.has(obj)) continue;
      const stack: { obj: ObjectResource; exit: boolean }[] = [
        { obj, exit: false },
      ];
      while (stack.length) {
        const frame = stack.pop()!;
        if (frame.exit) {
          state.set(frame.obj, 2);
          continue;
        }
        if (state.get(frame.obj) === 1) {
          this.error(
            "COMPONENT_CYCLE",
            String(frame.obj.id),
            "Cyclic component reference",
          );
          continue;
        }
        if (state.get(frame.obj) === 2) continue;
        state.set(frame.obj, 1);
        stack.push({ obj: frame.obj, exit: true });
        for (const child of this.graph.get(frame.obj) ?? [])
          stack.push({ obj: child, exit: false });
      }
    }
  }
}
type PropertyLookup = (
  pid: number,
  index: number,
  path: string,
) => Resource | undefined;

function safeKey(path: string): string {
  try {
    return pathKey(path);
  } catch {
    return path;
  }
}
