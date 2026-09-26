import { strFromU8, unzipSync, zipSync, type Zippable } from "fflate";
import { fail, ThreeMFError } from "../errors.js";
import type { ReadLimits, WriteOptions } from "../model/types.js";
import { pathKey } from "./paths.js";
export const DEFAULT_READ_LIMITS = Object.freeze({
  maxArchiveBytes: 256 * 1024 * 1024,
  maxEntries: 4096,
  maxPartBytes: 256 * 1024 * 1024,
  maxTotalBytes: 512 * 1024 * 1024,
  maxXmlDepth: 64,
  maxXmlNodes: 5_000_000,
});
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 255]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
/** Inspect the central directory before allocation; verify CRCs after extraction. ZIP64 is explicit unsupported. */
export function readZip(
  data: Uint8Array,
  options: ReadLimits = {},
): Map<string, Uint8Array> {
  const limits = { ...DEFAULT_READ_LIMITS, ...options };
  for (const [key, value] of Object.entries(limits))
    if (!Number.isSafeInteger(value) || value <= 0)
      fail("READ_LIMIT", `Invalid ${key}`);
  if (data.length > limits.maxArchiveBytes)
    fail("ZIP_LIMIT", "Archive size limit exceeded");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const u16 = (p: number) => view.getUint16(p, true),
    u32 = (p: number) => view.getUint32(p, true);
  let end = data.length - 22;
  while (
    end >= Math.max(0, data.length - 65557) &&
    (u32(end) !== 0x06054b50 || end + 22 + u16(end + 20) !== data.length)
  )
    end--;
  if (end < Math.max(0, data.length - 65557))
    fail("ZIP_FORMAT", "ZIP end record not found");
  const count = u16(end + 10),
    directorySize = u32(end + 12),
    directoryOffset = u32(end + 16);
  if (
    count === 65535 ||
    directoryOffset === 0xffffffff ||
    directorySize === 0xffffffff
  )
    fail("ZIP64_UNSUPPORTED", "ZIP64 is not supported");
  if (u16(end + 4) || u16(end + 6) || u16(end + 8) !== count)
    fail("ZIP_FORMAT", "Split ZIP archives are unsupported");
  if (count > limits.maxEntries || directoryOffset + directorySize > end)
    fail("ZIP_LIMIT", "Invalid or excessive ZIP directory");
  const names = new Set<string>(),
    records = new Map<string, { crc: number; size: number }>();
  let total = 0,
    pos = directoryOffset;
  for (let i = 0; i < count; i++) {
    if (pos + 46 > end || u32(pos) !== 0x02014b50)
      fail("ZIP_FORMAT", "Invalid central directory");
    const flags = u16(pos + 8),
      method = u16(pos + 10),
      crc = u32(pos + 16),
      compressed = u32(pos + 20),
      size = u32(pos + 24),
      nameLength = u16(pos + 28),
      extraLength = u16(pos + 30),
      commentLength = u16(pos + 32),
      local = u32(pos + 42);
    if (
      pos + 46 + nameLength + extraLength + commentLength > end ||
      local + 30 > directoryOffset
    )
      fail("ZIP_FORMAT", "Truncated ZIP entry");
    if (
      size === 0xffffffff ||
      compressed === 0xffffffff ||
      local === 0xffffffff
    )
      fail("ZIP64_UNSUPPORTED", "ZIP64 is not supported");
    if (flags & 1 || ![0, 8].includes(method))
      fail("ZIP_COMPRESSION", "Encrypted or unsupported ZIP entry");
    const nameBytes = data.subarray(pos + 46, pos + 46 + nameLength);
    if (!(flags & 2048) && nameBytes.some((b) => b > 127))
      fail("ZIP_ENCODING", "Non-UTF8 ZIP entry names are unsupported");
    const name = strFromU8(nameBytes);
    if (!name || name.startsWith("/"))
      fail("PART_PATH", "ZIP entries must be relative");
    if (
      u32(local) !== 0x04034b50 ||
      u16(local + 8) !== method ||
      u16(local + 6) !== flags
    )
      fail("ZIP_FORMAT", "Inconsistent local ZIP header");
    const start = local + 30 + u16(local + 26) + u16(local + 28);
    if (
      start + compressed > directoryOffset ||
      strFromU8(data.subarray(local + 30, local + 30 + u16(local + 26))) !==
        name
    )
      fail("ZIP_FORMAT", "Inconsistent ZIP entry data");
    if (method === 0 && compressed !== size)
      fail("ZIP_FORMAT", "Stored size mismatch");
    const key = pathKey("/" + (name.endsWith("/") ? name.slice(0, -1) : name));
    if (names.has(key)) fail("DUPLICATE_PART", `Duplicate ZIP entry ${name}`);
    names.add(key);
    total += size;
    if (size > limits.maxPartBytes || total > limits.maxTotalBytes)
      fail("ZIP_LIMIT", "Decompressed ZIP size limit exceeded");
    if (!name.endsWith("/")) records.set(name, { crc, size });
    pos += 46 + nameLength + extraLength + commentLength;
  }
  if (pos !== directoryOffset + directorySize)
    fail("ZIP_FORMAT", "Central directory size mismatch");
  try {
    const files = unzipSync(data, { filter: (file) => records.has(file.name) });
    const result = new Map<string, Uint8Array>();
    for (const [name, record] of records) {
      const bytes = files[name];
      if (!bytes || bytes.length !== record.size || crc32(bytes) !== record.crc)
        fail("ZIP_INTEGRITY", `CRC or size mismatch: ${name}`);
      result.set("/" + name, bytes);
    }
    return result;
  } catch (e) {
    if (e instanceof ThreeMFError) throw e;
    return fail("ZIP_FORMAT", String(e));
  }
}
export function writeZip(
  parts: ReadonlyMap<string, Uint8Array>,
  options: WriteOptions = {},
): Uint8Array {
  const entries: Zippable = Object.create(null) as Zippable;
  // Fixed ZIP timestamp makes repeated writes deterministic. Dates belong in metadata.
  for (const [path, data] of [...parts].sort(([a], [b]) => a.localeCompare(b)))
    entries[path.slice(1)] = [data, { mtime: new Date(1980, 0, 1) }];
  return zipSync(entries, { level: options.compressionLevel ?? 6 });
}
