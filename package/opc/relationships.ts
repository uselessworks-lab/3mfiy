import { CONTENT_TYPE, REL } from "../constants.js";
import { fail } from "../errors.js";
import type { Document, Relationship } from "../model/types.js";
import { pathKey, resolveTarget } from "./paths.js";
/** Generate the complete OPC relationships from typed references plus explicit custom links. */
export function documentRelationships(doc: Document): Relationship[] {
  const actual = new Map(
    [...doc.models, ...(doc.attachments ?? [])].map((p) => [
      pathKey(p.path),
      p.path,
    ]),
  );
  const canonical = (path: string) => actual.get(pathKey(path)) ?? path;
  const normalize = (r: Relationship): Relationship => ({
    ...r,
    source: r.source ? canonical(r.source) : undefined,
    target: r.external
      ? r.target
      : canonical(resolveTarget(r.source, r.target)),
  });
  // Explicit IDs may be referenced inside opaque attachments. Never merge these records.
  const list: Relationship[] = (doc.relationships ?? []).map(normalize);
  const add = (relationship: Relationship) => {
    const r = normalize(relationship);
    if (
      !list.some(
        (x) =>
          x.source === r.source &&
          x.type === r.type &&
          !x.external &&
          pathKey(x.target) === pathKey(r.target),
      )
    )
      list.push(r);
  };
  add({ type: REL.model, target: doc.root });
  for (const model of doc.models) {
    for (const r of model.resources) {
      if (r.kind === "object") {
        if (r.thumbnail)
          add({ source: model.path, type: REL.thumbnail, target: r.thumbnail });
        for (const c of r.components ?? [])
          if (c.path)
            add({ source: model.path, type: REL.model, target: c.path });
      }
      if (r.kind === "texture2d")
        add({ source: model.path, type: REL.texture, target: r.path });
    }
    for (const i of model.build)
      if (i.path) add({ source: model.path, type: REL.model, target: i.path });
  }
  return list;
}
export function checkRelationships(
  doc: Document,
  list: readonly Relationship[],
): void {
  const paths = new Set(
    [...doc.models, ...(doc.attachments ?? [])].map((p) => pathKey(p.path)),
  );
  const parts = [...doc.models, ...(doc.attachments ?? [])];
  for (const part of parts) {
    const key = pathKey(part.path);
    if (
      key === "/[content_types].xml" ||
      key.endsWith(".rels") ||
      key.includes("/_rels/")
    )
      fail("RESERVED_PART", `Reserved OPC part ${part.path}`);
  }
  for (const attachment of doc.attachments ?? []) {
    if (
      [CONTENT_TYPE.model, CONTENT_TYPE.relationships].some(
        (type) => type === attachment.contentType,
      )
    )
      fail(
        "RESERVED_CONTENT_TYPE",
        "Model and relationship content types must use typed document fields",
      );
    if (attachment.contentType.includes("digital-signature"))
      fail(
        "UNSUPPORTED_SIGNATURE",
        "Signed packages require signature verification and re-signing, which are unsupported",
      );
  }
  const models = new Set(doc.models.map((m) => pathKey(m.path)));
  const ids = new Map<string, Set<string>>();
  for (const r of list) {
    if (r.type.includes("/digital-signature/"))
      fail(
        "UNSUPPORTED_SIGNATURE",
        "Signed packages cannot be safely rewritten",
      );
    if (
      [REL.model, REL.texture, REL.thumbnail].some((type) => type === r.type) &&
      r.external
    )
      fail(
        "RELATIONSHIP_TARGET",
        "3MF model, texture and thumbnail relationships must be internal",
      );
    if (r.type === REL.model && !models.has(pathKey(r.target)))
      fail("MODEL_RELATIONSHIP", "Model relationships must target model parts");
    if (r.type === REL.texture || r.type === REL.thumbnail) {
      const target = doc.attachments?.find(
        (a) => pathKey(a.path) === pathKey(r.target),
      );
      if (!target || !["image/png", "image/jpeg"].includes(target.contentType))
        fail(
          "IMAGE_CONTENT_TYPE",
          "Texture/thumbnail relationships require PNG or JPEG attachments",
        );
    }
    if (r.source && !paths.has(pathKey(r.source)))
      fail("RELATIONSHIP_SOURCE", `Missing source ${r.source}`);
    if (!r.external && !paths.has(pathKey(resolveTarget(r.source, r.target))))
      fail("RELATIONSHIP_TARGET", `Missing target ${r.target}`);
    if (!r.type || !/^\w[\w+.-]*:/.test(r.type))
      fail("RELATIONSHIP_TYPE", "Relationship type must be an absolute URI");
    const source = r.source ? pathKey(r.source) : "";
    const set = ids.get(source) ?? new Set();
    if (r.id) {
      if (!/^[A-Za-z_][\w.-]*$/.test(r.id) || set.has(r.id))
        fail(
          "RELATIONSHIP_ID",
          "Relationship IDs must be unique XML IDs per source",
        );
      set.add(r.id);
    }
    ids.set(source, set);
  }
  const roots = list.filter((r) => !r.source && r.type === REL.model);
  if (
    roots.length !== 1 ||
    roots[0]!.external ||
    pathKey(roots[0]!.target) !== pathKey(doc.root)
  )
    fail(
      "ROOT_RELATIONSHIP",
      "Package must have exactly one internal root model relationship",
    );
  for (const model of doc.models)
    if (
      pathKey(model.path) !== pathKey(doc.root) &&
      !list.some(
        (r) =>
          r.source &&
          r.type === REL.model &&
          !r.external &&
          pathKey(r.target) === pathKey(model.path),
      )
    )
      fail(
        "MODEL_RELATIONSHIP",
        `Model part ${model.path} has no incoming model relationship`,
      );
}
