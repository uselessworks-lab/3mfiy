import { ThreeMFDocument } from "../dist/index.js";
import {
  BambuStudioProject,
  BambuProfile,
  BambuPlate,
} from "../dist/adapters/bambu.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { strFromU8, strToU8 } from "fflate";
import { createData3mf } from "./fixtures.mjs";
import { write3mf, read3mf } from "../dist/opc/package.js";
import { REL } from "../dist/index.js";
import { withBambuProject } from "../dist/adapters/bambu/project.js";
import {
  createBambuProjectSettings,
  readBambuProfiles,
} from "../dist/adapters/bambu/profiles.js";
import { readBambuPlates } from "../dist/adapters/bambu/plates.js";
import { tetrahedron, uuidFactory } from "./fixtures.mjs";
function fixture() {
  const assembly = createData3mf(
    [
      {
        name: "object",
        parts: [{ mesh: tetrahedron(), name: "part", color: "#123456" }],
      },
    ],
    { meshPath: "/3D/Objects/mesh.model", uuid: uuidFactory() },
  );
  const id = assembly.objects[0];
  return {
    document: assembly.document,
    project: {
      applicationVersion: "02.07.01.57",
      projectSettings: {
        printer_settings_id: "Caller owned printer",
        filament_colour: ["#123456"],
        future_vendor_options: ["preserve", "verbatim"],
      },
      objects: [
        {
          objectId: id.objectId,
          name: "object",
          parts: [{ objectId: id.partIds[0], extruder: 1, name: "part" }],
        },
      ],
      plates: [
        {
          id: 1,
          name: "plate <&>",
          instances: [{ objectId: id.objectId, instanceId: 0, identifyId: 1 }],
        },
      ],
    },
  };
}
test("Bambu is opt-in, preserves profile JSON, and maps parts and plates", () => {
  const { document, project } = fixture(),
    before = JSON.stringify(document);
  const source = ThreeMFDocument.fromData(document);
  const sourceProfile = new BambuProfile(project.projectSettings);
  const authoring = new BambuStudioProject(source, {
    applicationVersion: project.applicationVersion,
    profile: sourceProfile,
  });
  for (const object of project.objects) authoring.setObjectSettings(object);
  for (const plate of project.plates)
    authoring.addPlate(BambuPlate.fromData(plate));
  const first = authoring.write();
  authoring.profile.setOptions({
    future_vendor_options: ["updated after write"],
  });
  authoring.plates[0].configure({ name: "plate <&> edited" });
  const parsed = ThreeMFDocument.read(authoring.write()).toData();
  assert.notDeepEqual(first, authoring.write());
  assert.equal(
    BambuStudioProject.inspect(ThreeMFDocument.read(first)).plates[0].name,
    "plate <&>",
  );
  assert.equal(
    BambuStudioProject.inspect(ThreeMFDocument.read(authoring.write()))
      .plates[0].name,
    "plate <&> edited",
  );
  assert.deepEqual(sourceProfile.toData(), project.projectSettings);
  assert.deepEqual(source.toData(), document);
  assert.equal(JSON.stringify(document), before);
  const profile = parsed.attachments.find((a) =>
    a.path.endsWith("project_settings.config"),
  );
  assert.deepEqual(
    JSON.parse(strFromU8(profile.data)),
    authoring.profile.toData(),
  );
  assert.match(
    strFromU8(
      parsed.attachments.find((a) => a.path.endsWith("model_settings.config"))
        .data,
    ),
    /plate &lt;&amp;&gt;/,
  );
  assert.equal(
    parsed.models
      .find((m) => m.path === parsed.root)
      .metadata.find((v) => v.name === "Application").value,
    "BambuStudio-02.07.01.57",
  );
});
test("Bambu rejects nonexistent parts, slots, unassigned instances and non-JSON profile values", () => {
  for (const mutate of [
    (p) => (p.objects[0].parts[0].objectId = 999),
    (p) => (p.objects[0].parts[0].extruder = 0),
    (p) => (p.plates = []),
    (p) => (p.projectSettings.invalid = NaN),
  ]) {
    const { document, project } = fixture();
    mutate(project);
    assert.throws(() => withBambuProject(document, project));
  }
});

test("single-part filament assignment is promoted to the root object", () => {
  const { document, project } = fixture();
  project.projectSettings.filament_settings_id = ["PLA A", "PLA B"];
  project.projectSettings.filament_colour = ["#123456", "#ABCDEF"];
  project.objects[0].parts[0].extruder = 2;
  const result = withBambuProject(document, project);
  const xml = strFromU8(
    result.attachments.find((a) => a.path.endsWith("model_settings.config"))
      .data,
  );
  assert.match(
    xml,
    new RegExp(
      `<object id="${project.objects[0].objectId}"><metadata key="name" value="object"/><metadata key="extruder" value="2"/>`,
    ),
  );
  project.objects[0].extruder = 1;
  assert.throws(
    () => withBambuProject(document, project),
    (e) => e.code === "BAMBU_EXTRUDER",
  );
  delete project.objects[0].extruder;
  project.objects[0].parts[0].extruder = 3;
  assert.throws(
    () => withBambuProject(document, project),
    (e) => e.code === "BAMBU_EXTRUDER",
  );
});

test("multiple plates preserve per-plate settings, empty plates, PNG and repeated object instances", () => {
  const { document, project } = fixture();
  const root = document.models[0];
  root.build.push({
    ...root.build[0],
    uuid: "00000099-abcd-4abc-8abc-0123456789ab",
  });
  const png = Uint8Array.from(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP0kAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  const sharedPng = new Uint8Array(new SharedArrayBuffer(png.length));
  sharedPng.set(png);
  const ownedPlate = new BambuPlate(1, { thumbnail: sharedPng });
  sharedPng[0] = 0;
  assert.equal(ownedPlate.toData().thumbnail[0], 137);
  sharedPng.set(png);
  ownedPlate.configure({ thumbnail: sharedPng });
  sharedPng[0] = 0;
  assert.equal(ownedPlate.toData().thumbnail[0], 137);
  const assignment = project.plates[0].instances[0];
  const fromPlate = BambuPlate.fromData(project.plates[0]);
  const toPlate = new BambuPlate(2);
  assert.equal(
    fromPlate.removeInstance(assignment.objectId, assignment.instanceId),
    true,
  );
  toPlate.replaceInstances([assignment]);
  assert.equal(fromPlate.instances.length, 0);
  assert.deepEqual(toPlate.instances, [assignment]);
  project.projectSettings.filament_settings_id = ["PLA"];
  project.plates = [
    {
      ...project.plates[0],
      bedType: "Textured PEI Plate",
      printSequence: "by object",
      spiralMode: true,
      filamentMapMode: "Manual",
      filamentMaps: [1],
      filamentVolumeMaps: [0],
      firstLayerPrintSequence: [1],
      thumbnail: png,
    },
    { id: 2, name: "Empty", instances: [] },
    {
      id: 3,
      name: "Third",
      locked: true,
      instances: [
        { objectId: project.objects[0].objectId, instanceId: 1, identifyId: 2 },
      ],
    },
  ];
  const saved = read3mf(write3mf(withBambuProject(document, project))).document;
  const plates = readBambuPlates(saved);
  assert.equal(plates.length, 3);
  assert.equal(plates[1].instances.length, 0);
  assert.equal(plates[0].printSequence, "by object");
  assert.equal(plates[0].spiralMode, true);
  assert.deepEqual(plates[0].filamentMaps, [1]);
  assert.deepEqual(plates[0].thumbnail, png);
  assert.equal(plates[2].instances[0].instanceId, 1);
  const xml = strFromU8(
    saved.attachments.find((a) => a.path.endsWith("model_settings.config"))
      .data,
  );
  assert.match(xml, /key="spiral_mode" value="true"/);
  assert.match(xml, /key="thumbnail_file" value="Metadata\/plate_1.png"/);
  project.plates[2].id = 4;
  assert.throws(
    () => withBambuProject(document, project),
    (e) => e.code === "BAMBU_PLATE",
  );
});

test("embedded process, filament and machine presets have independent numbering and survive read/write", () => {
  const { document, project } = fixture();
  project.embeddedPresets = [
    {
      kind: "filament",
      config: {
        name: "PLA B",
        from: "project",
        version: "2.0.0",
        filament_settings_id: ["PLA B"],
        nozzle_temperature: ["220"],
        inherits: "System PLA",
      },
    },
    {
      kind: "machine",
      config: {
        name: "Printer X",
        from: "project",
        version: "2.0.0",
        printer_settings_id: "Printer X",
        inherits: "System Printer",
        nozzle_diameter: ["0.4", "0.4"],
      },
    },
    {
      kind: "process",
      config: {
        name: "Draft",
        from: "project",
        version: "2.0.0",
        print_settings_id: "Draft",
        inherits: "System Draft",
        layer_height: "0.2",
      },
    },
    {
      kind: "filament",
      config: {
        name: "PLA A",
        from: "project",
        version: "2.0.0",
        filament_settings_id: ["PLA A"],
        inherits: "System PLA",
        nozzle_temperature: ["215"],
      },
    },
  ];
  const saved = read3mf(write3mf(withBambuProject(document, project))).document;
  const profiles = readBambuProfiles(saved);
  assert.equal(profiles.embeddedPresets.length, 4);
  assert.ok(
    saved.attachments.some(
      (a) => a.path === "/Metadata/machine_settings_1.config",
    ),
  );
  assert.ok(
    saved.attachments.some(
      (a) => a.path === "/Metadata/filament_settings_2.config",
    ),
  );
  assert.ok(
    saved.attachments.some(
      (a) => a.path === "/Metadata/process_settings_1.config",
    ),
  );
  assert.equal(
    profiles.embeddedPresets.find((p) => p.config.name === "PLA B").config
      .inherits,
    "System PLA",
  );
  const { embeddedPresets, ...keep } = project;
  assert.equal(
    readBambuProfiles(withBambuProject(saved, keep)).embeddedPresets.length,
    4,
  );
  assert.equal(
    readBambuProfiles(withBambuProject(saved, { ...keep, embeddedPresets: [] }))
      .embeddedPresets.length,
    0,
  );
  project.embeddedPresets = [embeddedPresets[0], embeddedPresets[0]];
  assert.throws(
    () => withBambuProject(document, project),
    (e) => e.code === "BAMBU_PRESET",
  );
});

test("profile helper preserves dual-tool and variant arrays without guessing their dimensions", () => {
  const base = {
    filament_settings_id: ["A", "B"],
    filament_colour: ["#111111", "#222222"],
    filament_multi_colour: ["#111111", "#222222"],
    filament_type: ["PLA", "PETG"],
    filament_self_index: ["1", "1", "2", "2", "1", "1", "2", "2"],
    filament_extruder_variant: ["0", "1", "0", "1", "0", "1", "0", "1"],
    nozzle_diameter: ["0.4", "0.6"],
    flush_volumes_matrix: Array(8).fill("123"),
    future_array: ["a", "b", "c"],
  };
  const value = createBambuProjectSettings({
    base,
    filaments: [
      { settingsId: "A", color: "#112233" },
      { settingsId: "B", color: "#445566" },
    ],
  });
  assert.deepEqual(value.filament_colour, ["#112233", "#445566"]);
  assert.deepEqual(value.filament_multi_colour, value.filament_colour);
  for (const key of [
    "filament_self_index",
    "filament_extruder_variant",
    "nozzle_diameter",
    "flush_volumes_matrix",
    "future_array",
  ])
    assert.deepEqual(value[key], base[key]);
  assert.equal(base.filament_colour[0], "#111111");
  assert.throws(
    () =>
      createBambuProjectSettings({
        base,
        filaments: [{ settingsId: "A", color: "#112233" }],
      }),
    (e) => e.code === "BAMBU_FILAMENT",
  );
  assert.throws(
    () =>
      createBambuProjectSettings({
        filaments: [
          { settingsId: "A", color: "#112233", type: "PLA" },
          { settingsId: "B", color: "#445566" },
        ],
      }),
    (e) => e.code === "BAMBU_FILAMENT",
  );
});

test("unsupported plate overrides and malformed profiles fail explicitly", () => {
  for (const mutate of [
    (p) => (p.plates[0].settings = { bed_type: "hidden override" }),
    (p) => (p.plates[0].filamentMaps = [1]),
    (p) => (p.projectSettings.filament_settings_id = ["A", "B"]),
    (p) => (p.plates[0].thumbnail = new Uint8Array([0])),
    (p) => (p.projectSettings.nozzle_temperature = 220),
  ]) {
    const { document, project } = fixture();
    mutate(project);
    assert.throws(() => withBambuProject(document, project));
  }
});

test("profile helper preserves multi-color filament values on no-op and color edits", () => {
  const base = {
    filament_settings_id: ["Silk", "Solid"],
    filament_colour: ["#FF0000", "#FFFFFF"],
    filament_multi_colour: ["#FF0000 #0000FF", "#FFFFFF"],
  };
  const filaments = base.filament_settings_id.map((settingsId, i) => ({
    settingsId,
    color: base.filament_colour[i],
  }));
  assert.deepEqual(createBambuProjectSettings({ base, filaments }), base);
  const edited = createBambuProjectSettings({
    base,
    filaments: filaments.map((f) => ({ ...f, color: "#00FF00" })),
  });
  assert.deepEqual(edited.filament_multi_colour, [
    "#FF0000 #0000FF",
    "#00FF00",
  ]);
});

test("nested component part settings fail rather than being ignored by Studio", () => {
  const { document, project } = fixture();
  const model = document.models.find((m) => m.path !== document.root);
  const root = document.models.find((m) => m.path === document.root);
  const meshId = project.objects[0].parts[0].objectId;
  const nestedId = Math.max(...model.resources.map((r) => r.id)) + 1;
  model.resources.push({
    kind: "object",
    id: nestedId,
    uuid: "00000100-abcd-4abc-8abc-0123456789ab",
    components: [
      { objectId: meshId, uuid: "00000101-abcd-4abc-8abc-0123456789ab" },
    ],
  });
  root.resources.find(
    (r) => r.id === project.objects[0].objectId,
  ).components[0].objectId = nestedId;
  project.objects[0].parts[0].objectId = nestedId;
  assert.throws(
    () => withBambuProject(document, project),
    (e) => e.code === "BAMBU_PART",
  );
});

test("preset authoring requires a parent while profile reading preserves standalone data", () => {
  const { document, project } = fixture();
  const preset = {
    kind: "process",
    config: {
      name: "Draft",
      from: "project",
      version: "2.0.0",
      print_settings_id: "Draft",
    },
  };
  for (const inherits of [undefined, "", " "]) {
    project.embeddedPresets = [
      {
        ...preset,
        config: {
          ...preset.config,
          ...(inherits === undefined ? {} : { inherits }),
        },
      },
    ];
    assert.throws(
      () => withBambuProject(document, project),
      (e) => e.code === "BAMBU_PRESET",
    );
  }
  const imported = {
    ...document,
    attachments: [
      {
        path: "/Metadata/process_settings_1.config",
        contentType: "application/json",
        data: strToU8(JSON.stringify(preset.config)),
      },
    ],
  };
  assert.deepEqual(readBambuProfiles(imported).embeddedPresets, [preset]);
});

test("preset removal cleans inbound and outgoing relationships and retains unrelated links", () => {
  const { document, project } = fixture();
  project.embeddedPresets = [
    {
      kind: "process",
      config: {
        name: "Draft",
        from: "project",
        version: "2.0.0",
        print_settings_id: "Draft",
        inherits: "System Draft",
      },
    },
  ];
  const saved = withBambuProject(document, project);
  const path = "/Metadata/process_settings_1.config";
  saved.relationships = [
    { id: "preset", type: REL.mustPreserve, target: path },
    {
      id: "relative",
      source: "/Metadata/model_settings.config",
      type: REL.mustPreserve,
      target: "process_settings_1.config",
    },
    {
      id: "outgoing",
      source: path,
      type: "urn:example:documentation",
      target: "https://example.com/preset",
      external: true,
    },
    {
      id: "keep",
      type: REL.mustPreserve,
      target: "/Metadata/project_settings.config",
    },
  ];
  assert.equal(withBambuProject(saved, project).relationships.length, 4);
  const removed = withBambuProject(saved, { ...project, embeddedPresets: [] });
  assert.deepEqual(
    removed.relationships.map((r) => r.id),
    ["keep"],
  );
  const reread = read3mf(write3mf(removed)).document;
  assert.equal(readBambuProfiles(reread).embeddedPresets.length, 0);
});
