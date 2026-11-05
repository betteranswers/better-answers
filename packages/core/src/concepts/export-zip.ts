import { crc32, deflateRawSync } from "node:zlib";

import { byCodeUnit } from "@better-answers/schema/code-unit";

import { err, ok, type Result } from "../kernel/index.ts";

export type ZipEntry = { readonly path: string; readonly bytes: Uint8Array };

/** A zip without its 64-bit extension counts its entries in 16 bits. */
const ENTRIES_MAX = 0xff_ff;

const ONE_ANSWER_BYTES_MAX = 64 * 1024 * 1024;

const LOCAL = 0x04_03_4b_50;
const CENTRAL = 0x02_01_4b_50;
const END = 0x06_05_4b_50;

const VERSION = 20;
const UTF8_NAMES = 0x08_00;
const STORED = 0;
const DEFLATED = 8;

const LOCAL_SIZE = 30;
const CENTRAL_SIZE = 46;
const END_SIZE = 22;

type Packed = {
  readonly name: Buffer;
  readonly method: number;
  readonly crc: number;
  readonly data: Uint8Array;
  readonly size: number;
  readonly offset: number;
};

type Stamp = { readonly time: number; readonly date: number };

/** A zip stamps in MS-DOS fields, which start in 1980 and count seconds in twos. */
const stampOf = (at: Date): Stamp => ({
  time: (at.getUTCHours() << 11) | (at.getUTCMinutes() << 5) | (at.getUTCSeconds() >> 1),
  date:
    ((Math.max(at.getUTCFullYear(), 1980) - 1980) << 9) |
    ((at.getUTCMonth() + 1) << 5) |
    at.getUTCDate(),
});

const common = (header: Buffer, at: number, packed: Packed, stamp: Stamp): void => {
  header.writeUInt16LE(UTF8_NAMES, at);
  header.writeUInt16LE(packed.method, at + 2);
  header.writeUInt16LE(stamp.time, at + 4);
  header.writeUInt16LE(stamp.date, at + 6);
  header.writeUInt32LE(packed.crc, at + 8);
  header.writeUInt32LE(packed.data.length, at + 12);
  header.writeUInt32LE(packed.size, at + 16);
  header.writeUInt16LE(packed.name.length, at + 20);
};

const localOf = (packed: Packed, stamp: Stamp): Buffer => {
  const header = Buffer.alloc(LOCAL_SIZE);
  header.writeUInt32LE(LOCAL, 0);
  header.writeUInt16LE(VERSION, 4);
  common(header, 6, packed, stamp);
  return header;
};

const centralOf = (packed: Packed, stamp: Stamp): Buffer => {
  const header = Buffer.alloc(CENTRAL_SIZE);
  header.writeUInt32LE(CENTRAL, 0);
  header.writeUInt16LE(VERSION, 4);
  header.writeUInt16LE(VERSION, 6);
  common(header, 8, packed, stamp);
  header.writeUInt32LE(packed.offset, 42);
  return header;
};

const endOf = (entries: number, size: number, offset: number): Buffer => {
  const end = Buffer.alloc(END_SIZE);
  end.writeUInt32LE(END, 0);
  end.writeUInt16LE(entries, 8);
  end.writeUInt16LE(entries, 10);
  end.writeUInt32LE(size, 12);
  end.writeUInt32LE(offset, 16);
  return end;
};

const packedOf = ({ path, bytes }: ZipEntry, offset: number): Packed => {
  const deflated = deflateRawSync(bytes);
  const smaller = deflated.length < bytes.length;
  return {
    name: Buffer.from(path, "utf8"),
    method: smaller ? DEFLATED : STORED,
    crc: crc32(bytes),
    data: smaller ? deflated : bytes,
    size: bytes.length,
    offset,
  };
};

export const zipOf = (
  entries: readonly ZipEntry[],
  at: Date,
  bytesMax = ONE_ANSWER_BYTES_MAX,
): Result<Uint8Array, "export-too-large"> => {
  if (entries.length > ENTRIES_MAX) return err("export-too-large");
  const stamp = stampOf(at);
  const parts: Uint8Array[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries.toSorted((one, other) => byCodeUnit(one.path, other.path))) {
    if (entry.bytes.length > bytesMax) return err("export-too-large");
    const packed = packedOf(entry, offset);
    parts.push(localOf(packed, stamp), packed.name, packed.data);
    central.push(centralOf(packed, stamp), packed.name);
    offset += LOCAL_SIZE + packed.name.length + packed.data.length;
    if (offset > bytesMax) return err("export-too-large");
  }
  const directory = Buffer.concat(central);
  if (offset + directory.length + END_SIZE > bytesMax) return err("export-too-large");
  return ok(Buffer.concat([...parts, directory, endOf(entries.length, directory.length, offset)]));
};
