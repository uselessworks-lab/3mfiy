import { strToU8 } from "fflate";
import { CONTENT_TYPE, NS, REL } from "../constants.js";
import { fail } from "../errors.js";
import { assertValidDocument } from "../validate.js";
import { documentRelationships, checkRelationships } from "./relationships.js";
import type {
  Document,
  PackagePart,
  ReadOptions,
  ReadResult,
  Relationship,
  WriteOptions,
} from "../model/types.js";
import { parseModel, serializeModel } from "../xml/model.js";
import {
  attr,
  checkNode,
  element,
  parseXml,
  requiredAttr,
  XML_DECLARATION,
} from "../xml/primitives.js";
import {
  partPath,
  pathKey,
  relationshipSource,
  relationshipsPath,
  resolveTarget,
} from "./paths.js";
import { readZip, writeZip } from "./zip.js";
const xmlText = (data: Uint8Array): string => {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    return fail("XML_ENCODING", "Expected UTF-8 XML");
  }
};
const ctPath = "/[Content_Types].xml";
function relationshipXml(relationships: readonly Relationship[]): string {
  return (
    XML_DECLARATION +
    element(
      "Relationships",
      { xmlns: NS.relationships },
      relationships
        .map((r, i) =>
          element("Relationship", {
            Id: r.id ?? `r${i + 1}`,
            Type: r.type,
            Target: r.target,
            TargetMode: r.external ? "External" : undefined,
          }),
        )
        .join(""),
    )
  );
}
/** Serialize the validated model and OPC package to portable ZIP bytes. */
export function write3mf(
  document: Document,
  options: WriteOptions = {},
): Uint8Array {
  assertValidDocument(document, options.validation);
  const parts = new Map<string, Uint8Array>(),
    contentTypes = new Map<string, string>();
  const add = (path: string, type: string, data: Uint8Array) => {
    partPath(path);
    if ([...parts.keys()].some((p) => pathKey(p) === pathKey(path)))
      fail("DUPLICATE_PART", `Part collision ${path}`);
    parts.set(path, data);
    contentTypes.set(path, type);
  };
  for (const m of document.models)
    add(m.path, CONTENT_TYPE.model, strToU8(serializeModel(m)));
  for (const a of document.attachments ?? []) {
    if (pathKey(a.path) === pathKey(ctPath) || a.path.endsWith(".rels"))
      fail("RESERVED_PART", `Reserved OPC part ${a.path}`);
    add(a.path, a.contentType, a.data);
  }
  const relationships = documentRelationships(document);
  checkRelationships(document, relationships);
  const groups = new Map<string, Relationship[]>();
  for (const r of relationships) {
    const key = relationshipsPath(r.source);
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }
  for (const [path, list] of groups) {
    const used = new Set(list.flatMap((r) => (r.id ? [r.id] : [])));
    let n = 1;
    const withIds = list.map((r) => {
      if (r.id) return r;
      while (used.has(`r${n}`)) n++;
      const id = `r${n++}`;
      used.add(id);
      return { ...r, id };
    });
    add(path, CONTENT_TYPE.relationships, strToU8(relationshipXml(withIds)));
  }
  parts.set(
    ctPath,
    strToU8(
      XML_DECLARATION +
        element(
          "Types",
          { xmlns: NS.contentTypes },
          [...contentTypes]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([path, type]) =>
              element("Override", { PartName: path, ContentType: type }),
            )
            .join(""),
        ),
    ),
  );
  return writeZip(parts, options);
}
/** Parse all model parts, retain opaque attachments and validate references. No filesystem or DOM needed. */
export function read3mf(
  input: Uint8Array | ArrayBuffer,
  options: ReadOptions = {},
): ReadResult {
  const files = readZip(
    input instanceof Uint8Array ? input : new Uint8Array(input),
    options.limits,
  );
  const actualPaths = new Map([...files.keys()].map((p) => [pathKey(p), p]));
  const get = (path: string) => {
    const actual = actualPaths.get(pathKey(path));
    return actual ? files.get(actual) : undefined;
  };
  const contentXml = get(ctPath);
  if (!contentXml) fail("CONTENT_TYPES", "Missing [Content_Types].xml");
  const types = parseXml(xmlText(contentXml), options.limits);
  if (types.uri !== NS.contentTypes || types.local !== "Types")
    fail("CONTENT_TYPES", "Invalid content types document");
  checkNode(
    types,
    [],
    [`${NS.contentTypes}|Default`, `${NS.contentTypes}|Override`],
  );
  const defaults = new Map<string, string>(),
    overrides = new Map<string, string>();
  for (const node of types.children) {
    checkNode(
      node,
      node.local === "Default"
        ? ["|Extension", "|ContentType"]
        : ["|PartName", "|ContentType"],
      [],
    );
    const type = requiredAttr(node, "ContentType");
    const key =
      node.local === "Default"
        ? requiredAttr(node, "Extension").toLowerCase()
        : pathKey(requiredAttr(node, "PartName"));
    const map = node.local === "Default" ? defaults : overrides;
    if (map.has(key))
      fail("CONTENT_TYPES", "Duplicate content type declaration");
    map.set(key, type);
  }
  const typeOf = (path: string) =>
    overrides.get(pathKey(path)) ??
    defaults.get(path.split(".").at(-1)!.toLowerCase()) ??
    fail("CONTENT_TYPES", `Missing content type for ${path}`);
  const relationships: Relationship[] = [];
  for (const [path, bytes] of files) {
    if (pathKey(path) === pathKey(ctPath)) continue;
    if (!path.endsWith(".rels")) continue;
    if (typeOf(path) !== CONTENT_TYPE.relationships)
      fail("CONTENT_TYPES", "Invalid relationships content type");
    const source = relationshipSource(path);
    const root = parseXml(xmlText(bytes), options.limits);
    if (root.uri !== NS.relationships || root.local !== "Relationships")
      fail("RELATIONSHIPS", "Invalid relationship document");
    checkNode(root, [], [`${NS.relationships}|Relationship`]);
    for (const node of root.children) {
      checkNode(node, ["|Id", "|Type", "|Target", "|TargetMode"], []);
      const mode = attr(node, "TargetMode");
      if (mode && mode !== "Internal" && mode !== "External")
        fail("RELATIONSHIPS", "Invalid TargetMode");
      const external = mode === "External";
      const raw = requiredAttr(node, "Target");
      relationships.push({
        source,
        id: requiredAttr(node, "Id"),
        type: requiredAttr(node, "Type"),
        target: external ? raw : resolveTarget(source, raw),
        external: external || undefined,
      });
    }
  }
  const roots = relationships.filter(
    (r) => !r.source && r.type === REL.model && !r.external,
  );
  if (roots.length !== 1)
    fail("ROOT_RELATIONSHIP", "Exactly one root model relationship required");
  const root =
    actualPaths.get(pathKey(roots[0]!.target)) ??
    fail("ROOT_MODEL", "Missing root model part");
  const models: Document["models"][number][] = [],
    attachments: PackagePart[] = [];
  for (const [path, bytes] of files) {
    if (pathKey(path) === pathKey(ctPath) || path.endsWith(".rels")) continue;
    const contentType = typeOf(path);
    if (contentType === CONTENT_TYPE.model)
      models.push(parseModel(xmlText(bytes), path, options.limits));
    else attachments.push({ path, contentType, data: bytes });
  }
  const document: Document = { root, models, attachments, relationships };
  checkRelationships(document, relationships);
  // Every typed part reference must have the relationship required by OPC/3MF.
  for (const expected of documentRelationships({
    ...document,
    relationships: [],
  }))
    if (
      !relationships.some(
        (r) =>
          !r.external &&
          (r.source ? pathKey(r.source) : undefined) ===
            (expected.source ? pathKey(expected.source) : undefined) &&
          r.type === expected.type &&
          pathKey(r.target) === pathKey(expected.target),
      )
    )
      fail(
        "MISSING_RELATIONSHIP",
        `Missing ${expected.type} relationship to ${expected.target}`,
      );
  for (const model of models) {
    if (
      model.resources.some(
        (r) => r.kind === "object" && r.components?.some((c) => c.path),
      ) ||
      model.build.some((i) => i.path)
    ) {
      if (!model.requiredExtensions?.includes(NS.production))
        fail(
          "REQUIRED_EXTENSION",
          "Cross-model references require the Production extension",
        );
    }
  }
  return {
    document,
    diagnostics: assertValidDocument(document, options.validation),
  };
}
