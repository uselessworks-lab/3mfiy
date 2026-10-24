import { ThreeMFDocument } from './domain/document.js';
import { MeshGeometry, Transform3D } from './domain/geometry.js';
import { BaseMaterialsResource, ComponentsResource, MeshResource } from './domain/resources.js';
import { BambuProfile, BambuStudioProject, BambuPlate } from './adapters/bambu.js';
import { nearestFilamentSlot } from './filaments.js';
import type { Matrix4, Output, OutputComponent, OutputGeometry, OutputPlacement, PrintPlacement, PrintableProject, ThreeMfOptions } from './contracts.js';
export type { ThreeMfOptions, ThreeMfMetadata, PrintableProject } from './contracts.js';

function rgb(color: string): [number, number, number] {
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw Error('Invalid export material color.');
  return [1, 3, 5].map(i => Number.parseInt(color.slice(i, i + 2), 16)) as [number, number, number];
}
function settings(value: Readonly<Record<string, string>> | undefined): void {
  if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.entries(value).some(([key, item]) => !key.trim() || typeof item !== 'string')))
    throw Error('Invalid export settings.');
}
function transform(matrix?: Matrix4): Transform3D {
  if (matrix === undefined) return Transform3D.identity();
  if (!Array.isArray(matrix) || matrix.length !== 16 || matrix.some(v => !Number.isFinite(v))
    || matrix[3] !== 0 || matrix[7] !== 0 || matrix[11] !== 0 || matrix[15] !== 1)
    throw Error('Invalid affine transform.');
  return new Transform3D([matrix[0], matrix[1], matrix[2], matrix[4], matrix[5], matrix[6],
    matrix[8], matrix[9], matrix[10], matrix[12], matrix[13], matrix[14]]);
}
function inverse(pose: Transform3D): Transform3D {
  const t = pose.toData(), [a,d,g,b,e,h,c,f,i,x,y,z] = t;
  const determinant = pose.determinant;
  const A=(e*i-f*h)/determinant, B=(c*h-b*i)/determinant, C=(b*f-c*e)/determinant;
  const D=(f*g-d*i)/determinant, E=(a*i-c*g)/determinant, F=(c*d-a*f)/determinant;
  const G=(d*h-e*g)/determinant, H=(b*g-a*h)/determinant, I=(a*e-b*d)/determinant;
  return new Transform3D([A,D,G,B,E,H,C,F,I,-(A*x+B*y+C*z),-(D*x+E*y+F*z),-(G*x+H*y+I*z)]);
}
function unique<T extends { readonly id: string }>(values: readonly T[], label: string): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    if (!value.id?.trim() || result.has(value.id)) throw Error(`Invalid or duplicate ${label} ID.`);
    result.set(value.id, value);
  }
  return result;
}
function occurrence(placement: OutputPlacement): string { return placement.instanceId ?? placement.outputId; }

/** Indexes the canonical graph by reference. No second object/part tree is constructed. */
class PrintGraph {
  readonly plan: NonNullable<PrintableProject['printing']>;
  readonly outputs: Map<string, Output>;
  readonly geometries: Map<string, OutputGeometry>;
  readonly materials: Map<string, NonNullable<PrintableProject['materials']>[number]>;
  readonly plates: Map<string, NonNullable<PrintableProject['printing']>['plates'][number]>;
  private readonly assemblies = new Map<string, OutputPlacement>();
  private readonly meshes = new Map<string, MeshGeometry>();
  private readonly baked = new Map<string, Map<string, MeshGeometry>>();
  constructor(readonly source: PrintableProject, readonly options: ThreeMfOptions) {
    if (source.manufacturing?.eligible === false)
      throw Error(source.manufacturing.reason ?? 'This result is not eligible for manufacturing export.');
    if (!source.printing) throw Error('Export requires an explicit print plan.');
    this.plan = source.printing;
    this.outputs = unique(source.outputs, 'output');
    this.geometries = unique(source.geometries, 'geometry');
    this.materials = unique(source.materials ?? [], 'material');
    this.plates = unique(this.plan.plates, 'plate');
    if (!this.plan.placements.length || !this.plan.outputIds.length || !this.plan.plates.length)
      throw Error('At least one printable object and plate are required.');
    const selected = new Set(this.plan.outputIds), instances = new Set<string>(), covered = new Set<string>();
    if (selected.size !== this.plan.outputIds.length) throw Error('Duplicate selected output.');
    for (const plate of this.plan.plates) {
      if (plate.origin && (plate.origin.length !== 2 || plate.origin.some(value => !Number.isFinite(value))))
        throw Error('Invalid plate origin.');
    }
    for (const placement of options.assembly === 'print' || options.assembly === 'omit' ? [] : source.assembly?.placements ?? []) {
      const id = occurrence(placement);
      if (this.assemblies.has(id)) throw Error('Duplicate assembly occurrence.');
      this.assemblies.set(id, placement);
    }
    for (const placement of this.plan.placements) {
      const id = occurrence(placement), output = this.outputs.get(placement.outputId);
      if (!id.trim() || instances.has(id) || !selected.has(placement.outputId) || !output || !this.plates.has(placement.plateId))
        throw Error('Invalid print occurrence.');
      instances.add(id); covered.add(placement.outputId);
      if (!this.name(output).trim()) throw Error('Invalid export object name.');
      settings(output.print?.settings);
      if (output.print?.orientation) transform(output.print.orientation);
      unique(output.representations, 'representation');
      const parts = this.parts(placement);
      if (!parts.length) throw Error('At least one part is required.');
      unique(parts, 'part');
      transform(placement.transform);
      if (placement.sceneTransform) transform(placement.sceneTransform);
      for (const part of parts) {
        if (!this.partName(part).trim()) throw Error('Invalid export part name.');
        if (!this.geometries.has(part.geometryId)) throw Error('Unknown output geometry.');
        this.color(part); settings(part.print?.settings); transform(part.transform);
        if (part.print?.filamentPriority !== undefined && !Number.isFinite(part.print.filamentPriority))
          throw Error('Invalid filament priority.');
        if (part.print?.filamentSlot !== undefined && (!Number.isSafeInteger(part.print.filamentSlot) || part.print.filamentSlot < 1))
          throw Error('Invalid filament slot.');
      }
      const assembly = this.assemblies.get(id);
      if (options.assembly !== 'print' && options.assembly !== 'omit' && assembly && (assembly.outputId !== placement.outputId || assembly.representationId !== placement.representationId))
        throw Error('Assembly occurrence refers to a different output representation.');
    }
    if (covered.size !== selected.size) throw Error('Selected output has no print occurrence.');
  }
  output(placement: PrintPlacement): Output { return this.outputs.get(placement.outputId)!; }
  parts(placement: PrintPlacement): readonly OutputComponent[] {
    const representation = this.outputs.get(placement.outputId)?.representations.find(value => value.id === placement.representationId);
    if (!representation) throw Error('Unknown output representation.');
    return representation.components;
  }
  name(output: Output): string { return output.print?.name ?? output.label ?? output.id; }
  partName(part: OutputComponent): string { return part.print?.name ?? part.id; }
  color(part: OutputComponent): string {
    const material = part.materialId === undefined ? undefined : this.materials.get(part.materialId);
    if (part.materialId !== undefined && !material) throw Error('Unknown output material.');
    const color = material?.color ?? this.options.defaultColor ?? '#808080'; rgb(color); return color.toUpperCase();
  }
  materialName(part: OutputComponent): string {
    return part.print?.materialName ?? (part.materialId ? this.materials.get(part.materialId)?.label : undefined) ?? this.partName(part);
  }
  mesh(part: OutputComponent, placement: PrintPlacement): MeshGeometry {
    let mesh = this.meshes.get(part.geometryId);
    if (!mesh) {
      const value = this.geometries.get(part.geometryId)!.mesh;
      if (!(value.positions instanceof Float32Array || value.positions instanceof Float64Array)
        || !(value.indices instanceof Uint32Array) || value.positions.length < 9 || value.positions.length % 3
        || value.indices.length < 3 || value.indices.length % 3
        || value.positions.some(v => !Number.isFinite(v)) || value.indices.some(i => i >= value.positions.length / 3))
        throw Error('Invalid triangle mesh.');
      mesh = new MeshGeometry(Array.from(value.positions), Array.from(value.indices));
      this.meshes.set(part.geometryId, mesh);
    }
    if (!this.options.bakeTransforms) return mesh;
    const scene = this.scenePose(placement);
    const pose = part.transform ? transform(part.transform).then(scene) : scene;
    const key = JSON.stringify(pose.toData());
    let values = this.baked.get(part.geometryId);
    if (!values) { values = new Map(); this.baked.set(part.geometryId, values); }
    let baked = values.get(key);
    if (!baked) { baked = mesh.transformed(pose); values.set(key, baked); }
    return baked;
  }
  partPose(part: OutputComponent): Transform3D { return this.options.bakeTransforms ? Transform3D.identity() : transform(part.transform); }
  private scenePose(placement: PrintPlacement): Transform3D {
    if (placement.sceneTransform) return transform(placement.sceneTransform);
    const pose = transform(placement.transform), origin = this.plates.get(placement.plateId)!.origin;
    return origin ? pose.then(Transform3D.translation(origin[0], origin[1], 0)) : pose;
  }
  printPose(placement: PrintPlacement): Transform3D {
    return this.options.bakeTransforms ? Transform3D.identity() : this.scenePose(placement);
  }
  assemblyPose(placement: PrintPlacement): Transform3D {
    const assembly = this.assemblies.get(occurrence(placement));
    if (this.options.assembly === 'print' || !assembly) return this.printPose(placement);
    const pose = transform(assembly.transform);
    return this.options.bakeTransforms ? inverse(this.scenePose(placement)).then(pose) : pose;
  }
}

/** Canonical printable project → 3MF resources. Import this optional entry only when writing. */
export class PrintWriter {
  write(source: PrintableProject, options: ThreeMfOptions, signal?: AbortSignal): Uint8Array {
    signal?.throwIfAborted();
    if (!options.title.trim() || !['standard', 'bambu-project'].includes(options.format)
      || (options.assembly !== undefined && !['physical', 'print', 'omit'].includes(options.assembly))) throw Error('Invalid 3MF options.');
    if (options.format === 'bambu-project' && !options.project) throw Error('Bambu project configuration is required.');
    if (options.project?.meshLayout !== undefined && options.project.meshLayout !== 'parts') throw Error('Invalid child mesh layout.');
    const graph = new PrintGraph(source, options);
    let document = this.document(options);
    if (options.format === 'standard') this.standard(document, graph, signal);
    else document = this.bambu(document, graph, signal);
    signal?.throwIfAborted();
    const bytes = document.write({ validation: { topology: true } });
    ThreeMFDocument.read(bytes).assertValid();
    return bytes;
  }
  private document(options: ThreeMfOptions): ThreeMFDocument {
    const supplied = options.metadata, base = options.project?.metadata ?? [{ name: 'Title', value: options.title }];
    const metadata = supplied ? [...base.filter(item => !supplied.metadata.some(value => value.name === item.name)), ...supplied.metadata] : base;
    const document = new ThreeMFDocument('/3D/3dmodel.model', {
      unit: 'millimeter', language: options.format === 'standard' ? 'und' : 'en-US', metadata,
      ...(supplied?.namespaces ? { namespaces: supplied.namespaces } : {}),
    });
    for (const attachment of supplied?.attachments ?? [])
      document.addAttachment({ path: attachment.path, contentType: attachment.contentType, data: new TextEncoder().encode(attachment.text) });
    return document;
  }
  private standard(document: ThreeMFDocument, graph: PrintGraph, signal?: AbortSignal): void {
    const model = document.rootModel, palette = model.addBaseMaterials(), materials = new Map<string, number>();
    const resources = new Map<MeshGeometry, Map<number, number>>();
    for (const placement of graph.plan.placements) {
      signal?.throwIfAborted();
      const output = graph.output(placement), groupParts: { objectId: number; transform: Transform3D }[] = [];
      for (const part of graph.parts(placement)) {
        const color = graph.color(part), materialName = graph.materialName(part), key = JSON.stringify([materialName, color]);
        let index = materials.get(key);
        if (index === undefined) { index = palette.add(materialName, color); materials.set(key, index); }
        const mesh = graph.mesh(part, placement);
        let bindings = resources.get(mesh);
        if (!bindings) { bindings = new Map(); resources.set(mesh, bindings); }
        let id = bindings.get(index);
        if (id === undefined) { id = model.addMesh(mesh, { name: graph.partName(part) }).setProperty(palette.id, index).id; bindings.set(index, id); }
        groupParts.push({ objectId: id, transform: graph.partPose(part) });
      }
      const group = model.addComponents({ name: graph.name(output) });
      for (const part of groupParts) group.addComponent({ objectId: part.objectId, transform: part.transform.toData() });
      model.addBuildItem({ objectId: group.id, transform: graph.printPose(placement).toData() });
    }
  }
  private bambu(document: ThreeMFDocument, graph: PrintGraph, signal?: AbortSignal): ThreeMFDocument {
    const options = graph.options, suppliedPaths = options.project!.meshPaths, placements = graph.plan.placements;
    if (suppliedPaths && (Object.keys(suppliedPaths).length !== placements.length
      || placements.some(p => !Object.hasOwn(suppliedPaths, occurrence(p)))
      || Object.values(suppliedPaths).some(path => typeof path !== 'string' || !path.startsWith('/') || !path.endsWith('.model')
        || path === '/3D/3dmodel.model' || path.split('/').some(segment => segment === '..' || segment === '.'))))
      throw Error('Every export object needs a valid child model path.');
    const paths = placements.map(p => suppliedPaths?.[occurrence(p)] ?? options.project!.meshPath);
    const partPaths = paths.map((path, index) => graph.parts(placements[index]!).map((_, partIndex) =>
      options.project!.meshLayout === 'parts' ? path.replace(/\.model$/, `_${index + 1}_${partIndex + 1}.model`) : path));
    let nextId = 1;
    const resources = new Map<string, Map<MeshGeometry, Map<string, number>>>();
    const bindings = placements.map((placement, index) => {
      const componentIds = graph.parts(placement).map((part, partIndex) => {
        const path = partPaths[index]![partIndex]!;
        let pathResources = resources.get(path);
        if (!pathResources) { pathResources = new Map(); resources.set(path, pathResources); }
        const mesh = graph.mesh(part, placement);
        let values = pathResources.get(mesh);
        if (!values) { values = new Map(); pathResources.set(mesh, values); }
        const key = JSON.stringify([graph.materialName(part), graph.color(part), graph.partName(part),
          part.print?.settings, part.print?.filamentPriority, part.print?.filamentSlot]);
        let id = values.get(key);
        if (id === undefined) { id = nextId++; values.set(key, id); }
        return id;
      });
      return { componentIds, objectId: nextId++ };
    });
    const children = new Map<string, { child: ReturnType<ThreeMFDocument['createModel']>; materials: BaseMaterialsResource; colors: Map<string, number>; written: Set<number> }>();
    placements.forEach((placement, index) => {
      signal?.throwIfAborted();
      const binding = bindings[index]!;
      graph.parts(placement).forEach((part, partIndex) => {
        const path = partPaths[index]![partIndex]!;
        let state = children.get(path);
        if (!state) {
          const child = document.createModel(path, { unit: 'millimeter', language: 'en-US' });
          state = { child, materials: child.addResource(new BaseMaterialsResource(nextId++)), colors: new Map(), written: new Set() };
          children.set(path, state);
        }
        const { child, materials, colors, written } = state;
        const id = binding.componentIds[partIndex]!;
        if (written.has(id)) return;
        written.add(id);
        const name = graph.materialName(part), value = graph.color(part), key = JSON.stringify([name, value]);
        let color = colors.get(key);
        if (color === undefined) { color = materials.add(name, value + 'FF'); colors.set(key, color); }
        child.addResource(new MeshResource(id, graph.mesh(part, placement), { name: graph.partName(part) })).setProperty(materials.id, color);
      });
      const wrapper = document.rootModel.addResource(new ComponentsResource(binding.objectId, [], { name: graph.name(graph.output(placement)) }));
      binding.componentIds.forEach((id, partIndex) => wrapper.addComponent({ objectId: id, path: partPaths[index]![partIndex]!, transform: graph.partPose(graph.parts(placement)[partIndex]!).toData() }));
      document.rootModel.addBuildItem({ objectId: wrapper.id, transform: graph.printPose(placement).toData() });
    });
    document = document.withProductionUUIDs();
    const palette = options.project!.profile.filament_colour;
    if (!palette?.length) throw Error('Bambu project needs an explicit filament palette.');
    const profileColors = palette.map(rgb);
    const project = new BambuStudioProject(document, { applicationVersion: options.project!.applicationVersion, profile: new BambuProfile(options.project!.profile) });
    placements.forEach((placement, index) => {
      const binding = bindings[index]!;
      const parts = graph.parts(placement).map((part, partIndex) => {
        const color = graph.color(part);
        let slot = part.print?.filamentSlot;
        if (slot !== undefined) {
          if (slot > palette.length || palette[slot - 1]!.toUpperCase() !== color) throw Error('Explicit slots require matching profile colors.');
        } else slot = nearestFilamentSlot(rgb(color), profileColors);
        return { objectId: binding.componentIds[partIndex]!, name: graph.partName(part), extruder: slot,
          ...(part.print?.settings ? { settings: part.print.settings } : {}) };
      });
      const output = graph.output(placement);
      project.setObjectSettings({ objectId: binding.objectId, name: graph.name(output), extruder: parts.length === 1 ? parts[0]!.extruder : 1,
        ...(output.print?.settings ? { settings: output.print.settings } : {}), parts });
    });
    graph.plan.plates.forEach((plan, index) => {
      const name = plan.name ?? plan.id;
      const plate = project.addPlate(new BambuPlate(index + 1, { ...(name ? { name } : {}), locked: plan.locked ?? false }));
      placements.forEach((placement, objectIndex) => {
        if (placement.plateId === plan.id) plate.addInstance({ objectId: bindings[objectIndex]!.objectId, instanceId: 0, identifyId: 500 + objectIndex });
      });
    });
    if (options.assembly !== 'omit') project.setAssembly(placements.map((placement, index) => ({
      objectId: bindings[index]!.objectId, instanceId: 0, transform: graph.assemblyPose(placement).toData(), offset: [0, 0, 0],
    })));
    return project.toDocument();
  }
}
