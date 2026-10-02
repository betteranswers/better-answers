import { createHmac } from "node:crypto";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

const BITS_PER_CHARACTER = 5;

const STEP_SECONDS = 30;

const DIGITS = 6;

const bytesOf = (key: string): Buffer => {
  const bits = key
    .toUpperCase()
    .replaceAll("=", "")
    .split("")
    .map((character) => {
      const value = BASE32.indexOf(character);
      if (value < 0) throw new Error(`${character} is not a base32 character`);
      return value.toString(2).padStart(BITS_PER_CHARACTER, "0");
    })
    .join("");
  const whole = bits.slice(0, bits.length - (bits.length % 8));
  return Buffer.from((whole.match(/.{8}/g) ?? []).map((byte) => Number.parseInt(byte, 2)));
};

/** The six digits an authenticator holding `key`, base32 as a QR code carries it, shows at `at`. */
export const authenticatorCodeAt = (key: string, at: Date): string => {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at.getTime() / 1000 / STEP_SECONDS)));
  const mac = createHmac("sha1", bytesOf(key)).update(counter).digest();
  const offset = (mac.at(-1) ?? 0) & 0x0f;
  const truncated = mac.readUInt32BE(offset) & 0x7f_ff_ff_ff;
  return String(truncated % 10 ** DIGITS).padStart(DIGITS, "0");
};

/** The key an `otpauth://` address carries, as the setup screen writes it out. */
export const keyIn = (uri: string): string => new URL(uri).searchParams.get("secret") ?? "";
