import { NS } from "../constants.js";
import { fail } from "../errors.js";
import type {
  Resource,
  PropertyResource,
  BaseMaterials,
  ColorGroup,
  Texture2D,
  Texture2DGroup,
  CompositeMaterials,
  MultiProperties,
} from "../model/types.js";
import {
  attr,
  element,
  numberAttr,
  numbers,
  requiredAttr,
  type XmlNode,
} from "../xml/primitives.js";
import { ResourceCodec, type MaterialResource } from "./resource-codec.js";

const descriptors = {
  basematerials: {
    uri: NS.core,
    attributes: ["id"],
    child: "base",
    childAttributes: ["name", "displaycolor"],
  },
  colorgroup: {
    uri: NS.materials,
    attributes: ["id"],
    child: "color",
    childAttributes: ["color"],
  },
  texture2d: {
    uri: NS.materials,
    attributes: [
      "id",
      "path",
      "contenttype",
      "tilestyleu",
      "tilestylev",
      "filter",
    ],
    child: "",
    childAttributes: [],
  },
  texture2dgroup: {
    uri: NS.materials,
    attributes: ["id", "texid"],
    child: "tex2coord",
    childAttributes: ["u", "v"],
  },
  compositematerials: {
    uri: NS.materials,
    attributes: ["id", "matid", "matindices"],
    child: "composite",
    childAttributes: ["values"],
  },
  multiproperties: {
    uri: NS.materials,
    attributes: ["id", "pids", "blendmethods"],
    child: "multi",
    childAttributes: ["pindices"],
  },
} as const;

class BaseMaterialsCodec extends ResourceCodec<BaseMaterials> {
  constructor() {
    super("baseMaterials", "basematerials", descriptors.basematerials);
  }
  protected override decode(node: XmlNode, id: number): BaseMaterials {
    return {
      kind: "baseMaterials",
      id,
      bases: node.children.map((c) => ({
        name: requiredAttr(c, "name"),
        displayColor: requiredAttr(c, "displaycolor"),
      })),
    };
  }
  protected override encode(resource: BaseMaterials, _prefix: string): string {
    return element(
      "basematerials",
      { id: resource.id },
      resource.bases
        .map((b) =>
          element("base", { name: b.name, displaycolor: b.displayColor }),
        )
        .join(""),
    );
  }
  protected override count(resource: BaseMaterials): number {
    return resource.bases.length;
  }
}
class ColorGroupCodec extends ResourceCodec<ColorGroup> {
  constructor() {
    super("colorGroup", "colorgroup", descriptors.colorgroup);
  }
  protected override decode(node: XmlNode, id: number): ColorGroup {
    return {
      kind: "colorGroup",
      id,
      colors: node.children.map((c) => requiredAttr(c, "color")),
    };
  }
  protected override encode(resource: ColorGroup, prefix: string): string {
    const m = (name: string) => `${prefix}:${name}`;
    return element(
      m("colorgroup"),
      { id: resource.id },
      resource.colors.map((color) => element(m("color"), { color })).join(""),
    );
  }
  protected override count(resource: ColorGroup): number {
    return resource.colors.length;
  }
}
class Texture2DCodec extends ResourceCodec<Texture2D> {
  constructor() {
    super("texture2d", "texture2d", descriptors.texture2d);
  }
  protected override decode(node: XmlNode, id: number): Texture2D {
    return {
      kind: "texture2d",
      id,
      path: requiredAttr(node, "path"),
      contentType: requiredAttr(
        node,
        "contenttype",
      ) as Texture2D["contentType"],
      tileStyleU: attr(node, "tilestyleu") as Texture2D["tileStyleU"],
      tileStyleV: attr(node, "tilestylev") as Texture2D["tileStyleU"],
      filter: attr(node, "filter") as Texture2D["filter"],
    };
  }
  protected override encode(resource: Texture2D, prefix: string): string {
    const m = (name: string) => `${prefix}:${name}`;
    return element(m("texture2d"), {
      id: resource.id,
      path: resource.path,
      contenttype: resource.contentType,
      tilestyleu: resource.tileStyleU,
      tilestylev: resource.tileStyleV,
      filter: resource.filter,
    });
  }
}
class Texture2DGroupCodec extends ResourceCodec<Texture2DGroup> {
  constructor() {
    super("texture2dGroup", "texture2dgroup", descriptors.texture2dgroup);
  }
  protected override decode(node: XmlNode, id: number): Texture2DGroup {
    return {
      kind: "texture2dGroup",
      id,
      textureId: numberAttr(node, "texid")!,
      coordinates: node.children.map((c) => ({
        u: numberAttr(c, "u")!,
        v: numberAttr(c, "v")!,
      })),
    };
  }
  protected override encode(resource: Texture2DGroup, prefix: string): string {
    const m = (name: string) => `${prefix}:${name}`;
    return element(
      m("texture2dgroup"),
      { id: resource.id, texid: resource.textureId },
      resource.coordinates
        .map((c) => element(m("tex2coord"), { u: c.u, v: c.v }))
        .join(""),
    );
  }
  protected override count(resource: Texture2DGroup): number {
    return resource.coordinates.length;
  }
}
class CompositeMaterialsCodec extends ResourceCodec<CompositeMaterials> {
  constructor() {
    super(
      "compositeMaterials",
      "compositematerials",
      descriptors.compositematerials,
    );
  }
  protected override decode(node: XmlNode, id: number): CompositeMaterials {
    return {
      kind: "compositeMaterials",
      id,
      materialId: numberAttr(node, "matid")!,
      materialIndices: numbers(requiredAttr(node, "matindices")),
      composites: node.children.map((c) => numbers(requiredAttr(c, "values"))),
    };
  }
  protected override encode(
    resource: CompositeMaterials,
    prefix: string,
  ): string {
    const m = (name: string) => `${prefix}:${name}`;
    return element(
      m("compositematerials"),
      {
        id: resource.id,
        matid: resource.materialId,
        matindices: resource.materialIndices.join(" "),
      },
      resource.composites
        .map((values) => element(m("composite"), { values: values.join(" ") }))
        .join(""),
    );
  }
  protected override count(resource: CompositeMaterials): number {
    return resource.composites.length;
  }
}
class MultiPropertiesCodec extends ResourceCodec<MultiProperties> {
  constructor() {
    super("multiProperties", "multiproperties", descriptors.multiproperties);
  }
  protected override decode(node: XmlNode, id: number): MultiProperties {
    return {
      kind: "multiProperties",
      id,
      propertyIds: numbers(requiredAttr(node, "pids")),
      blendMethods: attr(node, "blendmethods")?.trim().split(/\s+/) as
        | ("mix" | "multiply")[]
        | undefined,
      properties: node.children.map((c) =>
        numbers(requiredAttr(c, "pindices")),
      ),
    };
  }
  protected override encode(resource: MultiProperties, prefix: string): string {
    const m = (name: string) => `${prefix}:${name}`;
    return element(
      m("multiproperties"),
      {
        id: resource.id,
        pids: resource.propertyIds.join(" "),
        blendmethods: resource.blendMethods?.join(" "),
      },
      resource.properties
        .map((p) => element(m("multi"), { pindices: p.join(" ") }))
        .join(""),
    );
  }
  protected override count(resource: MultiProperties): number {
    return resource.properties.length;
  }
}
/** Closed registry: adding a codec also requires a typed resource and validation support. */
const codecs: readonly ResourceCodec<MaterialResource>[] = [
  new BaseMaterialsCodec(),
  new ColorGroupCodec(),
  new Texture2DCodec(),
  new Texture2DGroupCodec(),
  new CompositeMaterialsCodec(),
  new MultiPropertiesCodec(),
];
const byElement = new Map(codecs.map((codec) => [codec.elementKey, codec]));
const byKind = new Map(codecs.map((codec) => [codec.kind, codec]));
export const materialElements = [...byElement.keys()];
export function readMaterial(node: XmlNode): MaterialResource {
  const codec = byElement.get(`${node.uri}|${node.local}`);
  if (!codec) fail("UNSUPPORTED_RESOURCE", `Unsupported resource ${node.name}`);
  return codec.read(node);
}
export function writeMaterial(
  resource: MaterialResource,
  prefix: string,
): string {
  return codecFor(resource).write(resource, prefix);
}
function codecFor(resource: MaterialResource): ResourceCodec<MaterialResource> {
  return (
    byKind.get(resource.kind) ??
    fail("UNSUPPORTED_RESOURCE", `Unsupported resource kind ${resource.kind}`)
  );
}
export function propertyCount(resource: Resource): number | undefined {
  return resource.kind === "object"
    ? undefined
    : byKind.get(resource.kind)?.propertyCount(resource);
}
export function isProperty(resource: Resource): resource is PropertyResource {
  return propertyCount(resource) !== undefined;
}
