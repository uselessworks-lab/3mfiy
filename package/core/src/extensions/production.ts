import { pathKey } from "../opc/paths.js";
import { NS } from "../constants.js";
import { fail } from "../errors.js";
import type { Document, Model } from "../model/types.js";
export function usesProduction(model: Model): boolean {
  return (
    model.buildUuid !== undefined ||
    !!model.requiredExtensions?.includes(NS.production) ||
    model.build.some((i) => i.path !== undefined || i.uuid !== undefined) ||
    model.resources.some(
      (r) =>
        r.kind === "object" &&
        (r.uuid !== undefined ||
          r.components?.some(
            (c) => c.path !== undefined || c.uuid !== undefined,
          )),
    )
  );
}
/** Add missing Production UUIDs without replacing existing identities or mutating input.
 * Supply a factory for reproducible fixtures or environments without Web Crypto.
 */
export function withProductionUUIDs(
  document: Document,
  uuid: () => string = () => {
    if (!globalThis.crypto?.randomUUID)
      fail(
        "UUID_UNAVAILABLE",
        "Supply a UUID factory in an environment without crypto.randomUUID",
      );
    return globalThis.crypto.randomUUID();
  },
): Document {
  return {
    ...document,
    models: document.models.map((model) => ({
      ...model,
      requiredExtensions: [
        ...new Set([...(model.requiredExtensions ?? []), NS.production]),
      ],
      buildUuid:
        model.buildUuid ??
        (pathKey(model.path) === pathKey(document.root) ? uuid() : undefined),
      resources: model.resources.map((r) =>
        r.kind !== "object"
          ? r
          : r.components
            ? {
                ...r,
                uuid: r.uuid ?? uuid(),
                components: r.components.map((c) => ({
                  ...c,
                  uuid: c.uuid ?? uuid(),
                })),
              }
            : { ...r, uuid: r.uuid ?? uuid() },
      ),
      build: model.build.map((i) => ({ ...i, uuid: i.uuid ?? uuid() })),
    })),
  };
}
