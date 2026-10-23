# @uselessworks/3mfiy

Bambu Project 이미지 첨부 경로는 `/Auxiliaries/Model%20Pictures/cover.png`처럼 인코딩한 URI를 사용합니다. ZIP에는 `Model Pictures`로 저장하며 읽을 때 같은 URI로 복원합니다.

3mfiy creates, reads, and edits 3MF files for 3D printing. Model generators such as Formify and Flexify can use it to package meshes, parts, materials, and placements into a single `.3mf` file for a slicer. Bambu Studio support adds plates, filament assignments, printer and print settings, embedded presets, and thumbnails.

Runs in Node.js 22+, browsers, and Web Workers, with TypeScript declarations included.

Bambu namespace를 선언한 모델은 `ThreeMFModel.setMetadata()` 또는 생성자의
`metadata`로 MakerWorld 모델/프로필 연결 키를 보존할 수 있습니다. 지원 이름과
제약은 [Bambu 지원 표](../docs/bambu-support.md#세부-지원-표)를 따릅니다.

## Installation

The package is being prepared for its first npm release. After publication:

```sh
npm install @uselessworks/3mfiy
```

Install directly from GitHub (Node.js 22+ and npm lifecycle scripts required):

```sh
npm install git+https://github.com/uselessworks-lab/3mfiy.git
```

Both paths expose the same core and Bambu entrypoints. Pin a Git commit or release tag for reproducibility. [Project overview](https://github.com/uselessworks-lab/3mfiy#readme) · [3MF support matrix](https://github.com/uselessworks-lab/3mfiy/blob/main/docs/spec-support.md) · [Bambu support matrix](https://github.com/uselessworks-lab/3mfiy/blob/main/docs/bambu-support.md).

Your application supplies the geometry, placements, and printer profiles. A slicer prepares the resulting file for printing.

## Create, edit and save

```ts
import {
  ThreeMFDocument,
  MeshGeometry,
  Transform3D,
  ThreeMFUnit,
} from "@uselessworks/3mfiy";

const geometry = new MeshGeometry(
  [0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 10],
  [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3],
);
const { document, objects } = ThreeMFDocument.create3mf(
  [
    {
      name: "Housing",
      transform: Transform3D.translation(20, 20, 0),
      parts: [{ mesh: geometry, color: "#F08040" }],
    },
  ],
  { unit: ThreeMFUnit.Millimeter },
);

const bytes = document.write({ validation: { topology: true } });
const loaded = ThreeMFDocument.read(bytes);
const diagnostics = loaded.validate();
```

`ThreeMFDocument.create3mf()` is the named creation entrypoint. For incremental construction, use `new ThreeMFBuilder(options).addObject(...).build()`. Both return a **`ThreeMFDocument` instance** and object/part ID bindings. Bindings belong to that build: IDs are allocated again and Production UUIDs generated for each build, so identity is not stable across builds. A later build does not mutate an earlier result.

To add and edit individual parts and materials:

```ts
const document = new ThreeMFDocument();
const model = document.rootModel;
const materials = model.addBaseMaterials();
const white = materials.add("White", "#FFFFFF");
const mesh = model.addMesh(geometry, { name: "Part" });
mesh.setProperty(materials.id, white);
mesh.setName("Renamed part");
mesh.replaceGeometry(
  mesh.geometry.transformed(Transform3D.translation(1, 0, 0)),
);
model.addBuildItem({ objectId: mesh.id });
document.assertValid();
const bytes = document.write();
```

Resources use the `ResourceNode → ObjectResourceNode / PropertyResourceNode` hierarchy. Concrete classes include `MeshResource`, `ComponentsResource`, `BaseMaterialsResource`, `ColorGroupResource`, `TextureResource`, `TextureCoordinatesResource`, `CompositeMaterialsResource` and `MultiPropertiesResource`. `model.requireResource(id)` returns an owned instance; narrow with `instanceof` to access subtype operations. `model.triangleProperty(id, triangle)` resolves property inheritance; `CompositeMaterialsResource.weights(index)` resolves normalized weights.

`MeshGeometry` and `Transform3D` are immutable values. `MeshGeometry.fromBuffers()` handles interleaved buffers. `Transform3D.then()` composes row-vector transforms in application order. Reflected geometry swaps triangle winding and corner properties to retain orientation. `document.withProductionUUIDs(factory?)` returns an independent document, leaving the source unchanged even if the factory fails. Supply `meshPath` during creation for multiple model parts.

## Ownership and data boundaries

- Document/model getters return live owned model/resource instances in copied arrays. Their methods edit that aggregate. Model paths and resource IDs cannot be reassigned through the public API.
- `addModel()` and `addResource()` adopt a clone and return the owned clone. The input instance stays independent. Resource adoption returns the declared type of `clone()`, so a subclass must override `clone()` to preserve its custom subtype.
- `fromData()` and `toData()` copy all data, including typed arrays and attachments. Modify snapshots freely without changing the source object. `DocumentData`, `ModelData`, `ResourceData`, `MeshData` and `TransformData` are serialization contracts, not authoring objects.
- Restore Worker/JSON data through `ThreeMFDocument.fromData()`. Sending a class instance directly does not preserve methods. Typed arrays require a suitable JSON encoding if JSON is chosen instead of structured clone.
- `model.replaceResource()` preserves declaration order; `removeBuildItem()` removes an instance. Plate assignments can be moved with `removeInstance()`/`addInstance()` or replaced with `replaceInstances()`.
- Empty drafts can be constructed. Local identity/path conflicts fail immediately; cross-resource semantics and package completeness are checked by `validate()`/`assertValid()`/`write()`.

String enums (`ThreeMFUnit`, `ThreeMFObjectType`, `TextureTileStyle`, `TextureFilter`, `BlendMethod`) define fixed spec values. Corresponding fields accept enum members or exact wire strings.

## Bambu Studio projects

```ts
import {
  BambuStudioProject,
  BambuProfile,
  BambuPlate,
  BambuPrintSequence,
} from "@uselessworks/3mfiy/bambu";

const profile = new BambuProfile(callerOwnedResolvedProfile);
profile.setFilaments([{ settingsId: "PLA white", color: "#FFFFFF" }]);
const project = new BambuStudioProject(document, {
  applicationVersion: studioVersion,
  profile,
});
project.setObjectSettings({ objectId: objects[0].objectId, extruder: 1 });
const plate = project.addPlate(
  new BambuPlate(1, {
    name: "First plate",
    printSequence: BambuPrintSequence.ByLayer,
  }),
);
plate.addInstance({
  objectId: objects[0].objectId,
  instanceId: 0,
  identifyId: 1,
});
const bytes = project.write();

// Live owned settings are regenerated on each write.
project.profile.setOptions({ filament_colour: ["#202020"] });
plate.configure({ name: "Updated plate" });
const updated = project.write();
const inspection = BambuStudioProject.inspect(ThreeMFDocument.read(updated));
const inspectedProfile = inspection.profile?.toData();
const inspectedPlates = inspection.plates;
```

The project owns a clone of the input document/profile. `project.document`, `project.profile` and the plate returned from `addPlate()` are its live owned objects. `toDocument()` returns a fresh standard document with the current Bambu configuration; `write()` serializes it. `inspect()` returns a separate inspection object with no write method: typed inspection covers only supported profile/plate fields.

Use `BambuPreset` and `project.setPresets()` for caller-owned machine/process/filament JSON. Writing requires a nonempty `inherits` parent installed in Studio; inheritance resolution is not provided. No call to `setPresets()` preserves existing preset files; `setPresets([])` removes modern embedded presets and their relationships. The `BambuPartSubtype`, `BambuPrintSequence` and `BambuPresetKind` enums define supported vendor values.

`BambuConfig` uses serialized `string | string[]` values. `BambuProfile.setFilaments()` preserves multi-color and multi-tool data and rejects automatic slot-count changes. Extruders are 1-based project filament slots; plate nozzle mapping has separate semantics. Part settings require direct mesh components. Single-part assignment is promoted to the object because Studio removes the part assignment.

Bambu authoring regenerates model settings and header-only slice info. It is for unsliced project authoring; full sliced-project editing, triangle painting and profile resolution are unsupported. Generic document read/write retains opaque vendor attachments. See the [Bambu support matrix](https://github.com/uselessworks-lab/3mfiy/blob/main/docs/bambu-support.md) for the detailed coverage.

## Scope and runtime

Core, Materials and Production support is documented in the [3MF support matrix](https://github.com/uselessworks-lab/3mfiy/blob/main/docs/spec-support.md); partial support does not imply full conformance. Unsupported model XML fails explicitly instead of being silently discarded. ZIP32/UTF-8 input has configurable size/complexity limits. Geometry/topology is validated without repair. Input is processed in memory; use a Worker for large files. Browser output is a `Uint8Array` that can be wrapped in a `Blob`; filesystem and download policy belong to the application.

## License

Licensed under the [MIT License](https://github.com/uselessworks-lab/3mfiy/blob/main/LICENSE). Copyright (c) 2026 useless works.

## Canonical print projects

```ts
import type { PrintableProject, ThreeMfOptions } from '@uselessworks/3mfiy/contracts';

async function exportProject(project: PrintableProject, signal?: AbortSignal) {
  const { PrintWriter } = await import('@uselessworks/3mfiy/print');
  const options: ThreeMfOptions = {
    title: 'Generated model',
    format: 'standard',
    defaultColor: '#808080',
  };
  return new PrintWriter().write(project, options, signal);
}
```

`PrintableProject<G>` is the neutral object/representation/part graph with a
geometry pool keyed by `geometryId`. The default `G` is completed `OutputGeometry`
with typed-array meshes. A generator may use its own geometry-pool value while
working, then materialize it before calling `PrintWriter`.

- `printing.outputIds` and `printing.placements` explicitly select occurrences.
  Each placement references one object, representation and plate. `instanceId`
  distinguishes repeated occurrences; when omitted it is the object ID.
- Part `print` owns optional `name`, `settings`, `filamentPriority`, `filamentSlot`
  and `materialName`. Object `print` owns optional `name` and `settings`. Source
  properties and entity relationships are preserved by callers and never inferred
  by the writer. Material color comes from `materialId`, falling back to the
  requested default color. Equal material name/color bindings and shared geometry
  are reused within the relevant 3MF model resource scope.
- Transforms are column-major affine 4×4 values. `component.transform` is local to
  its object; `PrintPlacement.transform` is plate-local. Plate `origin` adds the
  scene XY offset. Optional `sceneTransform` provides an exact already-computed
  scene pose when different arithmetic order must be preserved; it does not
  replace the physical plate-local transform.
- `assembly: 'physical'` (default) uses matching physical assembly occurrences,
  falling back to print placement when absent. `'print'` records print scene
  coordinates, and `'omit'` omits Bambu assembly metadata. Physical assembly
  representation matching is required only when physical assembly is used.
- `bakeTransforms: true` applies part and print scene transforms to mesh vertices,
  retains double precision, corrects reflected winding, and emits identity build
  transforms. A physical assembly pose is compensated for the baked print pose.
- Bambu project options require a caller-provided profile and explicit filament
  palette. Optional per-occurrence `meshPaths` controls child model resource
  distribution. Plate `name`, `locked`, and origin are caller policy.
- Manufacturing-ineligible results, invalid occurrence/material/geometry
  references, duplicates, invalid transforms, meshes and filament settings are
  rejected. Writing validates topology and reopens the archive for validation.
  The writer performs no slicing, auto-packing, printer-profile discovery or
  physical manufacturing certification.

`@uselessworks/3mfiy/filaments` exports `nearestFilamentSlot`,
`assignFilamentSlots`, `planFilamentSlots` and `summarizePrintColors` without
loading XML, ZIP or the print writer. Palette priority and first-slot tie behavior
match the generator's existing manufacturing calculations.

Object `print.orientation` is the pose before plate packing. Final print occurrences remain in `printing.placements`; repacking uses the original orientation rather than trying to recover it from a translated plate placement. Parts do not carry an object orientation. The type-only contract remains independent of the XML/ZIP writer.
