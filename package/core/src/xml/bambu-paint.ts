import { fail } from "../errors.js";
/** BambuStudio TriangleSelector::serialize / FacetsAnnotation wire order.
 * Only unsplit leaves are supported. Recursive subdivision is explicitly rejected.
 * Source: bambulab/BambuStudio src/libslic3r/{TriangleSelector,Model}.cpp (AGPL source consulted; independent implementation).
 */
export function writeBambuPaint(slot: number | undefined): string | undefined {
  if (slot === undefined) return undefined;
  if (!Number.isInteger(slot) || slot < 1 || slot > 255)
    fail("BAMBU_PAINT", "Filament slot must be 1..255");
  if (slot < 3) return (slot * 4).toString(16).toUpperCase();
  let remaining = slot - 3,
    suffix = "C";
  while (remaining >= 15) {
    suffix = "F" + suffix;
    remaining -= 15;
  }
  return remaining.toString(16).toUpperCase() + suffix;
}
export function readBambuPaint(value: string | undefined): number | undefined {
  if (value === undefined || value === "0") return undefined;
  if (value === "4") return 1;
  if (value === "8") return 2;
  if (!/^[0-9A-E]F*C$/.test(value))
    fail(
      "BAMBU_PAINT_UNSUPPORTED",
      "Only unsplit Bambu paint_color leaves are supported",
    );
  const slot = 3 + parseInt(value[0]!, 16) + (value.length - 2) * 15;
  if (slot > 255) fail("BAMBU_PAINT", "Filament slot exceeds 255");
  return slot;
}
