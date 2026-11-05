import { crc32, inflateRawSync } from "node:zlib";

const END_OF_DIRECTORY = Buffer.from([0x50, 0x4b, 0x05, 0x06]);

/** Reads a zip from its central directory, as an unzip tool does, failing an entry's bad CRC. */
export const zipEntries = (zip: Uint8Array): ReadonlyMap<string, Buffer> => {
  const bytes = Buffer.from(zip);
  const end = bytes.lastIndexOf(END_OF_DIRECTORY);
  const entries = new Map<string, Buffer>();
  let at = bytes.readUInt32LE(end + 16);
  for (let left = bytes.readUInt16LE(end + 10); left > 0; left -= 1) {
    const nameLength = bytes.readUInt16LE(at + 28);
    const name = bytes.toString("utf8", at + 46, at + 46 + nameLength);
    const local = bytes.readUInt32LE(at + 42);
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const data = bytes.subarray(start, start + bytes.readUInt32LE(at + 20));
    const content = bytes.readUInt16LE(at + 10) === 8 ? inflateRawSync(data) : Buffer.from(data);
    if (crc32(content) !== bytes.readUInt32LE(at + 16)) throw new Error(`${name} fails its CRC`);
    entries.set(name, content);
    at += 46 + nameLength + bytes.readUInt16LE(at + 30) + bytes.readUInt16LE(at + 32);
  }
  return entries;
};
