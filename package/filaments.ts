/** Return the one-based nearest RGB filament slot, preserving the first slot on ties. */
export function nearestFilamentSlot(
  color: readonly number[],
  palette: readonly (readonly number[])[],
): number {
  let slot = 1;
  let best = Infinity;
  palette.forEach((candidate, index) => {
    const distance = color.reduce((sum, channel, i) => sum + (channel - candidate[i]!) ** 2, 0);
    if (distance < best) {
      best = distance;
      slot = index + 1;
    }
  });
  return slot;
}

/** Assign distinct colors to the first available slots, then reuse the nearest slot. */
export function assignFilamentSlots(
  colors: readonly (readonly number[])[],
  maxSlots: number,
): number[] {
  return [
    ...planFilamentSlots(
      colors,
      maxSlots,
      colors.map(() => 0),
    ).slots,
  ];
}

export interface FilamentSlotPlan {
  readonly slots: readonly number[];
  readonly palette: readonly (readonly number[])[];
}

/** Keep source order until slots overflow, then reserve slots for higher-priority colors. */
export function planFilamentSlots(
  colors: readonly (readonly number[])[],
  maxSlots: number,
  priorities: readonly number[],
): FilamentSlotPlan {
  if (!Number.isInteger(maxSlots) || maxSlots < 1)
    throw new RangeError('A positive filament slot count is required.');
  if (priorities.length !== colors.length || priorities.some((value) => !Number.isFinite(value)))
    throw new RangeError('Every filament color needs a finite priority.');
  const unique = new Map<string, { color: readonly number[]; priority: number; order: number }>();
  colors.forEach((color, order) => {
    const key = color.join(',');
    const existing = unique.get(key);
    if (existing) existing.priority = Math.max(existing.priority, priorities[order]!);
    else unique.set(key, { color, priority: priorities[order]!, order });
  });
  const entries = [...unique.values()];
  if (entries.length > maxSlots)
    entries.sort((a, b) => b.priority - a.priority || a.order - b.order);
  const palette = entries.slice(0, maxSlots).map((entry) => entry.color);
  const assigned = new Map(
    entries.slice(0, maxSlots).map((entry, index) => [entry.color.join(','), index + 1]),
  );
  const slots = colors.map(
    (color) => assigned.get(color.join(',')) ?? nearestFilamentSlot(color, palette),
  );
  return { slots, palette };
}

/** 실제 palette planner와 같은 입력으로 색상 근사 수만 보고한다. */
export function summarizePrintColors(
  components: readonly {
    readonly color: readonly [number, number, number];
    readonly priority?: number;
  }[],
  slotCount: number,
) {
  const colors = components.map((component) => component.color),
    plan = planFilamentSlots(
      colors,
      slotCount,
      components.map((component) => component.priority ?? 0),
    );
  const used = new Set(colors.map((color) => color.join(','))),
    reserved = new Set(plan.palette.map((color) => color.join(',')));
  const remapped = [...used].filter((color) => !reserved.has(color)).length;
  return remapped ? { total: used.size, slots: slotCount, remapped } : undefined;
}
