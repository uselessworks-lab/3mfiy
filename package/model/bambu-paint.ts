import { fail } from "../errors.js";
import type { BambuTrianglePaint } from "./types.js";
/** Validate bounded trees and collect actual filament leaves, excluding inheritance. */
export function bambuPaintSlots(
  paint: BambuTrianglePaint | undefined,
): Set<number> {
  const slots = new Set<number>(),
    stack = [{ paint, depth: 0 }];
  let nodes = 0;
  while (stack.length) {
    const { paint: p, depth } = stack.pop()!;
    if (++nodes > 1000000 || depth > 64)
      fail("BAMBU_PAINT", "Paint tree exceeds depth/node limits");
    if (p === undefined) continue;
    if (typeof p === "number") {
      if (!Number.isInteger(p) || p < 1 || p > 255)
        fail("BAMBU_PAINT", "Filament slot must be 1..255");
      slots.add(p);
      continue;
    }
    if (
      !p ||
      ![1, 2, 3].includes(p.split) ||
      ![0, 1, 2].includes(p.side) ||
      (p.split === 3 && p.side !== 0) ||
      !Array.isArray(p.children) ||
      p.children.length !== p.split + 1
    )
      fail("BAMBU_PAINT", "Invalid paint subdivision");
    for (const child of p.children)
      stack.push({ paint: child, depth: depth + 1 });
  }
  return slots;
}
