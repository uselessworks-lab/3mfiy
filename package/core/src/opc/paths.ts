import { fail } from "../errors.js";
/** Canonical, absolute OPC part URI. Encoded separators and dot aliases are rejected. */
export function partPath(path: string): string {
  if (
    !path.startsWith("/") ||
    path.endsWith("/") ||
    /[\\?#\s\x00-\x1f]/u.test(path)
  )
    fail("PART_PATH", `Invalid part path: ${path}`);
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return fail("PART_PATH", `Invalid URI encoding: ${path}`);
  }
  if (
    decoded.includes("\\") ||
    /%2f|%5c/i.test(path) ||
    /[\x00-\x1f?#]/u.test(decoded) ||
    decoded
      .split("/")
      .slice(1)
      .some((s) => !s || s === "." || s === ".." || s.endsWith("."))
  )
    fail("PART_PATH", `Unsafe or noncanonical part path: ${path}`);
  return path;
}
export function pathKey(path: string): string {
  return decodeURIComponent(partPath(path)).toLowerCase();
}
export function resolveTarget(
  source: string | undefined,
  target: string,
): string {
  if (target.startsWith("/")) return partPath(target);
  if (/^[a-z][a-z0-9+.-]*:/i.test(target))
    fail("PART_PATH", "Internal relationship cannot target an external URI");
  const stack = source ? source.slice(1).split("/").slice(0, -1) : [];
  for (const segment of target.split("/")) {
    if (segment === ".") continue;
    if (segment === "..") {
      if (!stack.length) fail("PART_PATH", "Relationship escapes the package");
      stack.pop();
    } else stack.push(segment);
  }
  return partPath("/" + stack.join("/"));
}
export function relationshipsPath(source?: string): string {
  if (!source) return "/_rels/.rels";
  const index = source.lastIndexOf("/");
  return `${source.slice(0, index)}/_rels/${source.slice(index + 1)}.rels`;
}
export function relationshipSource(path: string): string | undefined {
  if (path === "/_rels/.rels") return undefined;
  const marker = "/_rels/";
  const index = path.lastIndexOf(marker);
  if (index < 0 || !path.endsWith(".rels"))
    fail("RELATIONSHIP_PATH", `Invalid relationship part ${path}`);
  return path.slice(0, index) + "/" + path.slice(index + marker.length, -5);
}
