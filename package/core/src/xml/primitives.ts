import { SaxesParser } from "saxes";
import { fail, ThreeMFError } from "../errors.js";
export interface XmlNode {
  name: string;
  local: string;
  uri: string;
  attributes: Record<string, string>;
  attributeUris: Record<string, string>;
  namespaces: Record<string, string>;
  children: XmlNode[];
  text: string;
}
export function parseXml(
  xml: string,
  limits: { maxXmlDepth?: number; maxXmlNodes?: number } = {},
): XmlNode {
  const parser = new SaxesParser({ xmlns: true });
  const stack: XmlNode[] = [];
  let root: XmlNode | undefined;
  let count = 0;
  parser.on("doctype", () =>
    fail("XML_DTD", "DTDs and entity declarations are not supported"),
  );
  parser.on("opentag", (tag) => {
    if (
      ++count > (limits.maxXmlNodes ?? 5_000_000) ||
      stack.length >= (limits.maxXmlDepth ?? 64)
    )
      fail("XML_LIMIT", "XML complexity limit exceeded");
    const parent = stack.at(-1);
    const node: XmlNode = {
      name: tag.name,
      local: tag.local,
      uri: tag.uri,
      attributes: Object.create(null) as Record<string, string>,
      attributeUris: Object.create(null) as Record<string, string>,
      namespaces: { ...parent?.namespaces, ...tag.ns },
      children: [],
      text: "",
    };
    for (const a of Object.values(tag.attributes)) {
      node.attributes[a.name] = a.value;
      node.attributeUris[a.name] = a.uri;
    }
    if (parent) parent.children.push(node);
    else root = node;
    stack.push(node);
  });
  parser.on("text", (value) => {
    const node = stack.at(-1);
    if (node) node.text += value;
  });
  parser.on("cdata", (value) => {
    const node = stack.at(-1);
    if (node) node.text += value;
  });
  parser.on("closetag", () => {
    stack.pop();
  });
  try {
    parser.write(xml).close();
  } catch (error) {
    if (error instanceof ThreeMFError) throw error;
    return fail("XML_PARSE", String(error));
  }
  if (!root) fail("XML_PARSE", "Missing root element");
  return root;
}
export function escapeXml(value: string): string {
  if (
    /[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/u.test(
      value,
    )
  )
    fail("XML_CHARACTER", "Invalid XML character");
  return value.replace(
    /[&<>"'\t\r\n]/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
        "\t": "&#9;",
        "\r": "&#13;",
        "\n": "&#10;",
      })[c]!,
  );
}
export function element(
  name: string,
  attributes: Record<string, string | number | boolean | undefined> = {},
  children = "",
): string {
  if (!/^[A-Za-z_][\w.:-]*$/.test(name))
    fail("XML_NAME", `Invalid XML name ${name}`);
  const attrs = Object.entries(attributes)
    .filter(([, v]) => v !== undefined)
    .map(([key, value]) => {
      if (!/^[A-Za-z_][\w.:-]*$/.test(key))
        fail("XML_NAME", `Invalid XML attribute ${key}`);
      return ` ${key}="${escapeXml(String(value))}"`;
    })
    .join("");
  return children
    ? `<${name}${attrs}>${children}</${name}>`
    : `<${name}${attrs}/>`;
}
export const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';
export function attr(
  node: XmlNode,
  name: string,
  uri = "",
): string | undefined {
  return Object.entries(node.attributes).find(
    ([key]) =>
      key.split(":").at(-1) === name && node.attributeUris[key] === uri,
  )?.[1];
}
export function requiredAttr(node: XmlNode, name: string, uri = ""): string {
  return (
    attr(node, name, uri) ??
    fail("XML_ATTRIBUTE", `${node.name} requires ${name}`)
  );
}
export function numberAttr(
  node: XmlNode,
  name: string,
  required = true,
): number | undefined {
  const value = attr(node, name);
  if (value === undefined) {
    if (required) fail("XML_ATTRIBUTE", `${node.name} requires ${name}`);
    return undefined;
  }
  return parseNumber(value);
}
export function parseNumber(value: string): number {
  if (
    !/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim()) ||
    !Number.isFinite(Number(value))
  )
    fail("XML_NUMBER", `Invalid 3MF number ${value}`);
  return Number(value);
}
export function numbers(value: string): number[] {
  return value.trim() ? value.trim().split(/\s+/).map(parseNumber) : [];
}
export function boolAttr(node: XmlNode, name: string): boolean | undefined {
  const value = attr(node, name);
  if (value === undefined) return undefined;
  if (!["0", "1", "true", "false"].includes(value))
    fail("XML_BOOLEAN", `Invalid boolean ${value}`);
  return value === "1" || value === "true";
}
/** Fail explicitly on unimplemented markup; no silent destructive import. */
export function checkNode(
  node: XmlNode,
  attributes: readonly string[],
  children: readonly string[],
): void {
  for (const key of Object.keys(node.attributes))
    if (
      key !== "xmlns" &&
      !key.startsWith("xmlns:") &&
      !attributes.includes(
        `${node.attributeUris[key]}|${key.split(":").at(-1)}`,
      )
    )
      fail("UNSUPPORTED_MARKUP", `Unsupported attribute ${node.name}/@${key}`);
  for (const child of node.children)
    if (!children.includes(`${child.uri}|${child.local}`))
      fail(
        "UNSUPPORTED_MARKUP",
        `Unsupported element ${node.name}/${child.name}`,
      );
  if (node.local !== "metadata" && node.text.trim())
    fail("XML_CONTENT", `Unexpected text in ${node.name}`);
}
export function onlyChild(
  node: XmlNode,
  local: string,
  uri: string,
  required = true,
): XmlNode | undefined {
  const children = node.children.filter(
    (c) => c.local === local && c.uri === uri,
  );
  if (children.length > 1 || (required && !children.length))
    fail(
      "XML_STRUCTURE",
      `${node.name} must have ${required ? "exactly" : "at most"} one ${local}`,
    );
  return children[0];
}
