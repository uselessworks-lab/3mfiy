/** Internal snapshot boundary. structuredClone alone shares SharedArrayBuffer storage. */
export class DataSnapshot {
  static copy<T>(input: T): T {
    const snapshot: T = structuredClone(input);
    const copies = new WeakMap<object, unknown>();
    const detach = (value: unknown): unknown => {
      if (value === null || typeof value !== "object") return value;
      if (copies.has(value)) return copies.get(value);
      if (ArrayBuffer.isView(value)) {
        if (
          typeof SharedArrayBuffer === "undefined" ||
          !(value.buffer instanceof SharedArrayBuffer)
        ) {
          copies.set(value, value);
          return value;
        }
        // structuredClone normalizes typed-array subclasses; all standard typed arrays implement slice.
        const result =
          value instanceof DataView
            ? new DataView(
                new Uint8Array(
                  value.buffer,
                  value.byteOffset,
                  value.byteLength,
                ).slice().buffer,
              )
            : (value as Float64Array).slice();
        copies.set(value, result);
        return result;
      }
      if (
        typeof SharedArrayBuffer !== "undefined" &&
        value instanceof SharedArrayBuffer
      ) {
        const result = value.slice(0);
        copies.set(value, result);
        return result;
      }
      copies.set(value, value);
      for (const [key, child] of Object.entries(value))
        (value as Record<string, unknown>)[key] = detach(child);
      return value;
    };
    return detach(snapshot) as T;
  }
}
