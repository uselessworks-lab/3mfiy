import { BambuPartSubtype } from "./types.js";
import { strToU8 } from "fflate";
import { fail } from "../../errors.js";
import { IDENTITY } from "../../model/helpers.js";
import { assertValidDocument } from "../../validate.js";
import type { Document } from "../../model/types.js";
import { pathKey, resolveTarget } from "../../opc/paths.js";
import { element, XML_DECLARATION } from "../../xml/primitives.js";
import { REL } from "../../constants.js";
import { filamentSlotCount, presetParts, isPresetPath } from "./profiles.js";
import {
  plateXml,
  plateThumbnail,
  isPositiveId as validId,
  settingsXml as metadata,
} from "./plates.js";
import type {
  BambuPartSettings,
  BambuProject,
  BambuAssemblyItem,
} from "./types.js";
const BAMBU_NS = "http://schemas.bambulab.com/package/2021";
function objectMetadata(object: BambuPartSettings, slots?: number): string {
  if (
    object.extruder !== undefined &&
    (!validId(object.extruder) ||
      (slots !== undefined && object.extruder > slots))
  )
    fail(
      "BAMBU_EXTRUDER",
      "Extruder must reference a 1-based project filament slot",
    );
  if (
    object.settings &&
    ("name" in object.settings || "extruder" in object.settings)
  )
    fail("BAMBU_SETTING", "Use explicit name/extruder fields");
  return metadata({
    ...object.settings,
    ...(object.name === undefined ? {} : { name: object.name }),
    ...(object.extruder === undefined ? {} : { extruder: object.extruder }),
  });
}
/** Attach Bambu project settings without mutating the standard document. Existing vendor files are replaced explicitly. */
export function withBambuProject(
  document: Document,
  project: BambuProject,
): Document {
  assertValidDocument(document);
  if (!project.applicationVersion.trim())
    fail("BAMBU_VERSION", "An application version is required");
  const root = document.models.find(
    (m) => pathKey(m.path) === pathKey(document.root),
  )!;
  const objects = new Map(
    root.resources.filter((r) => r.kind === "object").map((r) => [r.id, r]),
  );
  const slots = filamentSlotCount(project.projectSettings);
  if (!project.projectSettings.filament_colour?.length)
    fail(
      "BAMBU_FILAMENT",
      "Bambu projects require a nonempty filament_colour vector",
    );
  if (
    root.build.some(
      (item) =>
        item.path !== undefined && pathKey(item.path) !== pathKey(root.path),
    )
  )
    fail(
      "BAMBU_OBJECT",
      "Bambu plate settings require local root build objects; wrap cross-model items in components",
    );
  const configured = new Set<number>();
  for (const object of project.objects) {
    if (!objects.has(object.objectId) || configured.has(object.objectId))
      fail(
        "BAMBU_OBJECT",
        "Object settings must reference distinct root objects",
      );
    configured.add(object.objectId);
    objectMetadata(object, slots);
    const refs = objects.get(object.objectId)!.components ?? [];
    const seen = new Set<number>();
    for (const part of object.parts ?? []) {
      objectMetadata(part, slots);
      if (
        part.subtype !== undefined &&
        !Object.values<string>(BambuPartSubtype).includes(part.subtype)
      )
        fail("BAMBU_PART", "Unsupported part subtype");
      if (
        !refs.some((c) => c.objectId === part.objectId) ||
        seen.has(part.objectId)
      )
        fail(
          "BAMBU_PART",
          "Part settings must reference distinct direct component IDs",
        );
      seen.add(part.objectId);
      if (refs.filter((c) => c.objectId === part.objectId).length !== 1)
        fail(
          "BAMBU_PART",
          "Ambiguous part IDs across model files are not supported by this adapter",
        );
      const ref = refs.find((c) => c.objectId === part.objectId)!;
      const model = document.models.find(
        (m) => pathKey(m.path) === pathKey(ref.path ?? root.path),
      )!;
      const target = model.resources.find(
        (r) => r.kind === "object" && r.id === ref.objectId,
      );
      if (target?.kind !== "object" || !target.mesh)
        fail(
          "BAMBU_PART",
          "Part settings require direct mesh components; nested component settings are unsupported",
        );
    }
  }
  const instances = new Map<number, number>();
  for (const item of root.build)
    instances.set(item.objectId, (instances.get(item.objectId) ?? 0) + 1);
  const checkInstance = (objectId: number, instanceId: number) => {
    if (!validId(instanceId, 0) || instanceId >= (instances.get(objectId) ?? 0))
      fail(
        "BAMBU_INSTANCE",
        "Instance must reference a root build item (zero-based per object)",
      );
  };
  const assigned = new Set<string>(),
    plateIds = new Set<number>(),
    identifyIds = new Set<number>();
  for (const plate of project.plates) {
    if (!validId(plate.id) || plateIds.has(plate.id))
      fail("BAMBU_PLATE", "Plate IDs must be unique positive integers");
    plateIds.add(plate.id);
    for (const instance of plate.instances) {
      checkInstance(instance.objectId, instance.instanceId);
      const key = `${instance.objectId}/${instance.instanceId}`;
      if (
        assigned.has(key) ||
        !validId(instance.identifyId, 0) ||
        identifyIds.has(instance.identifyId)
      )
        fail("BAMBU_INSTANCE", "Each instance and identify ID must be unique");
      assigned.add(key);
      identifyIds.add(instance.identifyId);
    }
  }
  for (let id = 1; id <= project.plates.length; id++)
    if (!plateIds.has(id))
      fail(
        "BAMBU_PLATE",
        "Plate IDs must be contiguous from 1; Studio indexes them as id-1",
      );
  if (assigned.size !== root.build.length)
    fail("BAMBU_PLATE", "Every root build item must be assigned to a plate");
  const counts = new Map<number, number>();
  const assembly: readonly BambuAssemblyItem[] =
    project.assembly ??
    root.build.map((item) => {
      const instanceId = counts.get(item.objectId) ?? 0;
      counts.set(item.objectId, instanceId + 1);
      return {
        objectId: item.objectId,
        instanceId,
        transform: item.transform ?? IDENTITY,
      };
    });
  const assemblyIds = new Set<string>();
  for (const item of assembly) {
    checkInstance(item.objectId, item.instanceId);
    const key = `${item.objectId}/${item.instanceId}`;
    if (assemblyIds.has(key)) fail("BAMBU_ASSEMBLY", "Duplicate assembly item");
    assemblyIds.add(key);
    if (
      item.transform.length !== 12 ||
      item.transform.some((n) => !Number.isFinite(n)) ||
      (item.offset !== undefined &&
        (item.offset.length !== 3 ||
          item.offset.some((n) => !Number.isFinite(n))))
    )
      fail("BAMBU_ASSEMBLY", "Assembly transforms and offsets must be finite");
  }
  const objectXml = project.objects
    .map((o) => {
      const refs = objects.get(o.objectId)!.components;
      const single = refs?.length === 1;
      const part = o.parts?.find((p) => p.objectId === refs?.[0]?.objectId);
      if (
        single &&
        part?.extruder !== undefined &&
        o.extruder !== undefined &&
        o.extruder !== part.extruder
      )
        fail(
          "BAMBU_EXTRUDER",
          "Single-part object and part extruders disagree; Studio discards the part assignment",
        );
      const extruder = o.extruder ?? (single ? part?.extruder : undefined);
      return element(
        "object",
        { id: o.objectId },
        objectMetadata({ ...o, extruder }, slots) +
          (o.parts ?? [])
            .map((p) =>
              element(
                "part",
                {
                  id: p.objectId,
                  subtype: p.subtype ?? BambuPartSubtype.Normal,
                },
                objectMetadata(p, slots),
              ),
            )
            .join(""),
      );
    })
    .join("");
  const plates = project.plates
    .map((p) =>
      plateXml(p, slots, project.projectSettings.nozzle_diameter?.length),
    )
    .join("");
  const assemble = element(
    "assemble",
    {},
    assembly
      .map((i) =>
        element("assemble_item", {
          object_id: i.objectId,
          instance_id: i.instanceId,
          transform: i.transform.join(" "),
          offset: (i.offset ?? [0, 0, 0]).join(" "),
        }),
      )
      .join(""),
  );
  const profile = JSON.stringify(project.projectSettings);
  const thumbnails = project.plates
    .map(plateThumbnail)
    .filter((part): part is NonNullable<typeof part> => part !== undefined);
  const attachments = [
    ...thumbnails,
    ...(project.embeddedPresets === undefined
      ? []
      : presetParts(project.embeddedPresets)),
    {
      path: "/Metadata/model_settings.config",
      contentType: "text/xml",
      data: strToU8(
        XML_DECLARATION + element("config", {}, objectXml + plates + assemble),
      ),
    },
    {
      path: "/Metadata/project_settings.config",
      contentType: "application/json",
      data: strToU8(profile),
    },
    {
      path: "/Metadata/slice_info.config",
      contentType: "text/xml",
      data: strToU8(
        XML_DECLARATION +
          element(
            "config",
            {},
            element(
              "header",
              {},
              element("header_item", {
                key: "X-BBL-Client-Type",
                value: "slicer",
              }) +
                element("header_item", {
                  key: "X-BBL-Client-Version",
                  value: project.applicationVersion,
                }),
            ),
          ),
      ),
    },
  ];
  const namespaces = { ...root.namespaces };
  let prefix =
    Object.keys(namespaces).find((p) => namespaces[p] === BAMBU_NS) ??
    "BambuStudio";
  if (namespaces[prefix] && namespaces[prefix] !== BAMBU_NS)
    fail(
      "BAMBU_NAMESPACE",
      "BambuStudio namespace is already bound to another URI",
    );
  namespaces[prefix] = BAMBU_NS;
  const versionName = prefix + ":3mfVersion";
  const removedPresets = new Set(
    (document.attachments ?? [])
      .filter(
        (a) =>
          project.embeddedPresets !== undefined &&
          isPresetPath(a.path) &&
          !attachments.some((b) => pathKey(a.path) === pathKey(b.path)),
      )
      .map((a) => pathKey(a.path)),
  );
  const result: Document = {
    ...document,
    relationships: document.relationships?.filter(
      (r) =>
        !(r.source && removedPresets.has(pathKey(r.source))) &&
        !(
          !r.external &&
          removedPresets.has(pathKey(resolveTarget(r.source, r.target)))
        ),
    ),
    models: document.models.map((m) =>
      m === root
        ? {
            ...m,
            namespaces,
            metadata: [
              ...(m.metadata ?? []).filter(
                (v) => v.name !== "Application" && v.name !== versionName,
              ),
              { name: versionName, value: "1" },
              {
                name: "Application",
                value: `BambuStudio-${project.applicationVersion}`,
              },
            ],
          }
        : m,
    ),
    attachments: [
      ...(document.attachments ?? []).filter(
        (a) =>
          !attachments.some((b) => pathKey(a.path) === pathKey(b.path)) &&
          !(project.embeddedPresets !== undefined && isPresetPath(a.path)),
      ),
      ...attachments,
    ],
  };
  // A standard package thumbnail lets Studio and other consumers show the first plate preview.
  if (
    thumbnails[0] &&
    !(result.relationships ?? []).some(
      (r) => !r.source && r.type === REL.thumbnail,
    )
  )
    result.relationships = [
      ...(result.relationships ?? []),
      { type: REL.thumbnail, target: thumbnails[0].path },
    ];
  assertValidDocument(result);
  return result;
}
