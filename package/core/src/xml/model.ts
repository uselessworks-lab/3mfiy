import { NS } from "../constants.js";
import { fail } from "../errors.js";
import {
  materialElements,
  readMaterial,
  writeMaterial,
} from "../extensions/materials.js";
import { usesProduction } from "../extensions/production.js";
import type {
  BuildItem,
  Metadata,
  Model,
  ObjectReference,
  ObjectResource,
  ReadLimits,
  Resource,
  Transform,
  TriangleProperties,
} from "../model/types.js";
import {
  attr,
  boolAttr,
  checkNode,
  element,
  escapeXml,
  numberAttr,
  numbers,
  onlyChild,
  parseXml,
  requiredAttr,
  XML_DECLARATION,
  type XmlNode,
} from "./primitives.js";
const core = (name: string) => `${NS.core}|${name}`;
const plain = (...names: string[]) => names.map((n) => "|" + n);
function metadata(node: XmlNode): Metadata {
  checkNode(node, plain("name", "preserve", "type"), []);
  return {
    name: requiredAttr(node, "name"),
    value: node.text,
    preserve: boolAttr(node, "preserve"),
    type: attr(node, "type"),
  };
}
function metadataGroup(parent: XmlNode): Metadata[] | undefined {
  const group = onlyChild(parent, "metadatagroup", NS.core, false);
  if (!group) return undefined;
  checkNode(group, [], [core("metadata")]);
  return group.children.map(metadata);
}
function reference(node: XmlNode): ObjectReference {
  const t = attr(node, "transform");
  const values = t === undefined ? undefined : numbers(t);
  if (values && values.length !== 12)
    fail("TRANSFORM", "Transform requires 12 numbers");
  return {
    objectId: numberAttr(node, "objectid")!,
    path: attr(node, "path", NS.production),
    uuid: attr(node, "UUID", NS.production),
    transform: values as Transform | undefined,
  };
}
const referenceAttrs = [
  ...plain("objectid", "transform"),
  `${NS.production}|path`,
  `${NS.production}|UUID`,
];
function readObject(node: XmlNode): ObjectResource {
  checkNode(
    node,
    [
      ...plain(
        "id",
        "name",
        "type",
        "partnumber",
        "thumbnail",
        "pid",
        "pindex",
      ),
      `${NS.production}|UUID`,
    ],
    [core("mesh"), core("components"), core("metadatagroup")],
  );
  const base = {
    kind: "object" as const,
    id: numberAttr(node, "id")!,
    name: attr(node, "name"),
    type: attr(node, "type") as ObjectResource["type"],
    partNumber: attr(node, "partnumber"),
    thumbnail: attr(node, "thumbnail"),
    uuid: attr(node, "UUID", NS.production),
    metadata: metadataGroup(node),
  };
  const mesh = onlyChild(node, "mesh", NS.core, false);
  const components = onlyChild(node, "components", NS.core, false);
  if (!!mesh === !!components)
    fail(
      "OBJECT_SHAPE",
      "Object requires exactly one mesh or components element",
    );
  const pid = numberAttr(node, "pid", false);
  const pindex = numberAttr(node, "pindex", false);
  if ((pid === undefined) !== (pindex === undefined))
    fail("PROPERTY", "Object pid and pindex must be specified together");
  if (components) {
    if (pid !== undefined)
      fail("PROPERTY", "Components object cannot carry properties");
    checkNode(components, [], [core("component")]);
    return {
      ...base,
      components: components.children.map((c) => {
        checkNode(c, referenceAttrs, []);
        return reference(c);
      }),
    };
  }
  checkNode(mesh!, [], [core("vertices"), core("triangles")]);
  const vertices = onlyChild(mesh!, "vertices", NS.core)!;
  const triangles = onlyChild(mesh!, "triangles", NS.core)!;
  checkNode(vertices, [], [core("vertex")]);
  checkNode(triangles, [], [core("triangle")]);
  const positions = new Float64Array(vertices.children.length * 3);
  const indices: number[] = [];
  const properties: (TriangleProperties | undefined)[] = [];
  vertices.children.forEach((v, i) => {
    checkNode(v, plain("x", "y", "z"), []);
    positions.set(
      [numberAttr(v, "x")!, numberAttr(v, "y")!, numberAttr(v, "z")!],
      i * 3,
    );
  });
  for (const t of triangles.children) {
    checkNode(t, plain("v1", "v2", "v3", "pid", "p1", "p2", "p3"), []);
    indices.push(
      numberAttr(t, "v1")!,
      numberAttr(t, "v2")!,
      numberAttr(t, "v3")!,
    );
    const p = {
      pid: numberAttr(t, "pid", false),
      p1: numberAttr(t, "p1", false),
      p2: numberAttr(t, "p2", false),
      p3: numberAttr(t, "p3", false),
    };
    properties.push(
      Object.values(p).some((v) => v !== undefined) ? p : undefined,
    );
  }
  return {
    ...base,
    property: pid === undefined ? undefined : { pid, index: pindex! },
    mesh: {
      positions,
      indices,
      properties: properties.some(Boolean) ? properties : undefined,
    },
  };
}
export function parseModel(
  xml: string,
  path: string,
  limits: ReadLimits = {},
): Model {
  const root = parseXml(xml, limits);
  if (root.local !== "model" || root.uri !== NS.core)
    fail("MODEL_NAMESPACE", "Not a Core 3MF model");
  checkNode(
    root,
    [
      ...plain("unit", "requiredextensions", "recommendedextensions"),
      `${NS.xml}|lang`,
    ],
    [core("metadata"), core("resources"), core("build")],
  );
  const extensionUris = (name: string) =>
    attr(root, name)
      ?.trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(
        (prefix) =>
          root.namespaces[prefix] ??
          fail("EXTENSION_NAMESPACE", `Undeclared extension ${prefix}`),
      );
  const requiredExtensions = extensionUris("requiredextensions");
  for (const uri of requiredExtensions ?? [])
    if (uri !== NS.production && uri !== NS.materials)
      fail("UNSUPPORTED_EXTENSION", `Unsupported required extension ${uri}`);
  const resources = onlyChild(root, "resources", NS.core)!;
  const build = onlyChild(root, "build", NS.core)!;
  checkNode(resources, [], [core("object"), ...materialElements]);
  checkNode(build, [`${NS.production}|UUID`], [core("item")]);
  return {
    path,
    unit: attr(root, "unit") as Model["unit"],
    language: attr(root, "lang", NS.xml),
    namespaces: Object.fromEntries(
      Object.entries(root.namespaces).filter(([p]) => p && p !== "xml"),
    ),
    requiredExtensions,
    recommendedExtensions: extensionUris("recommendedextensions"),
    metadata: root.children.filter((n) => n.local === "metadata").map(metadata),
    resources: resources.children.map(
      (node): Resource =>
        node.uri === NS.core && node.local === "object"
          ? readObject(node)
          : readMaterial(node),
    ),
    buildUuid: attr(build, "UUID", NS.production),
    build: build.children.map((node): BuildItem => {
      checkNode(
        node,
        [...referenceAttrs, ...plain("partnumber", "printable")],
        [core("metadatagroup")],
      );
      return {
        ...reference(node),
        partNumber: attr(node, "partnumber"),
        printable: boolAttr(node, "printable"),
        metadata: metadataGroup(node),
      };
    }),
  };
}
function writeMetadata(items: readonly Metadata[] | undefined): string {
  return (items ?? [])
    .map((m) =>
      element(
        "metadata",
        { name: m.name, preserve: m.preserve, type: m.type },
        escapeXml(m.value),
      ),
    )
    .join("");
}
function writeMetadataGroup(items: readonly Metadata[] | undefined): string {
  return items?.length
    ? element("metadatagroup", {}, writeMetadata(items))
    : "";
}
export function serializeModel(model: Model): string {
  // Keep metadata QName prefixes, and allocate collision-free extension prefixes.
  const namespaces: Record<string, string> = { ...model.namespaces };
  const prefixFor = (uri: string, preferred: string): string => {
    const existing = Object.keys(namespaces).find((k) => namespaces[k] === uri);
    if (existing) return existing;
    let prefix = preferred,
      suffix = 1;
    while (namespaces[prefix]) prefix = preferred + suffix++;
    namespaces[prefix] = uri;
    return prefix;
  };
  const required = new Set(model.requiredExtensions ?? []);
  const material = model.resources.some(
    (r) => r.kind !== "object" && r.kind !== "baseMaterials",
  );
  if (material) required.add(NS.materials);
  if (usesProduction(model)) required.add(NS.production);
  const mp = material ? prefixFor(NS.materials, "m") : "m";
  const pp = usesProduction(model) ? prefixFor(NS.production, "p") : "p";
  const requiredPrefixes = [...required].map((uri) => prefixFor(uri, "ext"));
  const recommendedPrefixes = (model.recommendedExtensions ?? []).map((uri) =>
    prefixFor(uri, "ext"),
  );
  const referenceAttributes = (r: ObjectReference) => ({
    objectid: r.objectId,
    transform: r.transform?.join(" "),
    [`${pp}:path`]: r.path,
    [`${pp}:UUID`]: r.uuid,
  });
  const resources = model.resources
    .map((r) => {
      if (r.kind !== "object") return writeMaterial(r, mp);
      const attributes = {
        id: r.id,
        name: r.name,
        type: r.type,
        partnumber: r.partNumber,
        thumbnail: r.thumbnail,
        pid: r.property?.pid,
        pindex: r.property?.index,
        [`${pp}:UUID`]: r.uuid,
      };
      let shape: string;
      if (r.components)
        shape = element(
          "components",
          {},
          r.components
            .map((c) => element("component", referenceAttributes(c)))
            .join(""),
        );
      else {
        const mesh = r.mesh,
          vertices: string[] = [],
          triangles: string[] = [];
        for (let i = 0; i < mesh.positions.length; i += 3)
          vertices.push(
            element("vertex", {
              x: mesh.positions[i],
              y: mesh.positions[i + 1],
              z: mesh.positions[i + 2],
            }),
          );
        for (let i = 0; i < mesh.indices.length; i += 3)
          triangles.push(
            element("triangle", {
              v1: mesh.indices[i],
              v2: mesh.indices[i + 1],
              v3: mesh.indices[i + 2],
              ...mesh.properties?.[i / 3],
            }),
          );
        shape = element(
          "mesh",
          {},
          element("vertices", {}, vertices.join("")) +
            element("triangles", {}, triangles.join("")),
        );
      }
      return element(
        "object",
        attributes,
        writeMetadataGroup(r.metadata) + shape,
      );
    })
    .join("");
  return (
    XML_DECLARATION +
    element(
      "model",
      {
        xmlns: NS.core,
        ...Object.fromEntries(
          Object.entries(namespaces).map(([prefix, uri]) => [
            "xmlns:" + prefix,
            uri,
          ]),
        ),
        unit: model.unit,
        "xml:lang": model.language ?? "und",
        requiredextensions: requiredPrefixes.length
          ? requiredPrefixes.join(" ")
          : undefined,
        recommendedextensions: recommendedPrefixes.length
          ? recommendedPrefixes.join(" ")
          : undefined,
      },
      writeMetadata(model.metadata) +
        element("resources", {}, resources) +
        element(
          "build",
          { [`${pp}:UUID`]: model.buildUuid },
          model.build
            .map((item) =>
              element(
                "item",
                {
                  ...referenceAttributes(item),
                  partnumber: item.partNumber,
                  printable: item.printable,
                },
                writeMetadataGroup(item.metadata),
              ),
            )
            .join(""),
        ),
    )
  );
}
