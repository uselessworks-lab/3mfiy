import { fail } from "../errors.js";
import type { Resource } from "../model/types.js";
import { checkNode, numberAttr, type XmlNode } from "../xml/primitives.js";
export type MaterialResource = Exclude<Resource, { kind: "object" }>;
interface ResourceShape {
  readonly uri: string;
  readonly attributes: readonly string[];
  readonly child: string;
  readonly childAttributes: readonly string[];
}
/** Shared XML contract; concrete codecs own only their resource's payload. Internal extension boundary. */
export abstract class ResourceCodec<T extends MaterialResource> {
  readonly elementKey: string;
  protected constructor(
    readonly kind: T["kind"],
    localName: string,
    private readonly shape: ResourceShape,
  ) {
    this.elementKey = `${shape.uri}|${localName}`;
  }
  read(node: XmlNode): T {
    if (`${node.uri}|${node.local}` !== this.elementKey)
      fail("RESOURCE_NAMESPACE", `Expected ${this.elementKey}`);
    checkNode(
      node,
      this.shape.attributes.map((a) => "|" + a),
      this.shape.child ? [`${this.shape.uri}|${this.shape.child}`] : [],
    );
    for (const child of node.children)
      checkNode(
        child,
        this.shape.childAttributes.map((a) => "|" + a),
        [],
      );
    return this.decode(node, numberAttr(node, "id")!);
  }
  write(resource: MaterialResource, prefix: string): string {
    if (!this.accepts(resource)) fail("RESOURCE_KIND", `Expected ${this.kind}`);
    return this.encode(resource, prefix);
  }
  propertyCount(resource: MaterialResource): number | undefined {
    if (!this.accepts(resource)) fail("RESOURCE_KIND", `Expected ${this.kind}`);
    return this.count(resource);
  }
  private accepts(resource: MaterialResource): resource is T {
    return resource.kind === this.kind;
  }
  protected abstract decode(node: XmlNode, id: number): T;
  protected abstract encode(resource: T, prefix: string): string;
  protected count(_resource: T): number | undefined {
    return undefined;
  }
}
