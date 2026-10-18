import { fail } from "../errors.js";
import { bambuPaintSlots } from "../model/bambu-paint.js";
import type { BambuTrianglePaint } from "../model/types.js";
/** Independently implemented Bambu FacetsAnnotation nibble codec. The XML
 * string reverses the preorder nibble stream; child traversal is also reversed.
 * Format reference: official TriangleSelector::serialize and Model.cpp.
 */
export function writeBambuPaint(
  paint: BambuTrianglePaint | undefined,
): string | undefined {
  if (paint === undefined) return undefined;
  bambuPaintSlots(paint);
  const digits: string[] = [];
  function append(p: BambuTrianglePaint | undefined): void {
    if (p === undefined) {
      digits.push("0");
      return;
    }
    if (typeof p === "number") {
      if (p < 3) {
        digits.push((p * 4).toString(16));
        return;
      }
      digits.push("C");
      let remaining = p - 3;
      while (remaining >= 15) {
        digits.push("F");
        remaining -= 15;
      }
      digits.push(remaining.toString(16).toUpperCase());
      return;
    }
    digits.push(((p.side << 2) | p.split).toString(16).toUpperCase());
    for (let i = p.children.length - 1; i >= 0; i--) append(p.children[i]);
  }
  append(paint);
  return digits.reverse().join("");
}
export function readBambuPaint(
  value: string | undefined,
): BambuTrianglePaint | undefined {
  if (value === undefined) return undefined;
  if (!/^[0-9A-F]+$/.test(value) || value.length > 2000000)
    fail("BAMBU_PAINT", "Invalid paint nibble stream");
  let cursor = value.length - 1,
    nodes = 0;
  const next = () => {
    if (cursor < 0) fail("BAMBU_PAINT", "Truncated paint tree");
    return parseInt(value[cursor--]!, 16);
  };
  function read(depth: number): BambuTrianglePaint | undefined {
    if (depth > 64 || ++nodes > 1000000)
      fail("BAMBU_PAINT", "Paint tree exceeds depth/node limits");
    const code = next(),
      split = code & 3,
      side = code >> 2;
    if (split) {
      if (side > 2 || (split === 3 && side !== 0))
        fail("BAMBU_PAINT", "Invalid split side");
      const children: (BambuTrianglePaint | undefined)[] = Array(split + 1);
      for (let i = split; i >= 0; i--) children[i] = read(depth + 1);
      return { split: split as 1 | 2 | 3, side: side as 0 | 1 | 2, children };
    }
    let slot = side;
    if (slot === 3) {
      slot = 3;
      let digit = next();
      while (digit === 15) {
        slot += 15;
        if (slot > 255) fail("BAMBU_PAINT", "Filament slot exceeds 255");
        digit = next();
      }
      slot += digit;
    }
    if (slot > 255) fail("BAMBU_PAINT", "Filament slot exceeds 255");
    return slot === 0 ? undefined : slot;
  }
  const paint = read(0);
  if (cursor !== -1) fail("BAMBU_PAINT", "Trailing paint nibbles");
  return paint;
}
