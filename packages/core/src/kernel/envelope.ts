import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { err, ok, type Result } from "./result.ts";
import type { KernelRefusal } from "./vocabulary.ts";

export const ENVELOPE_AEAD = "aes-256-gcm";
export const ENVELOPE_VERSION = 1;
export const ENVELOPE_KEY_BYTES = 32;
export const ENVELOPE_NONCE_BYTES = 12;
export const ENVELOPE_TAG_BYTES = 16;
export const ENVELOPE_VERSION_BYTES = 1;

const SHORTEST_FRAME = ENVELOPE_VERSION_BYTES + ENVELOPE_NONCE_BYTES + ENVELOPE_TAG_BYTES;

export type OpenEnvelopeRefusal = KernelRefusal<
  "envelope-version-unknown" | "envelope-malformed" | "envelope-not-authentic"
>;

// A wrong key length is the caller's defect: a refusal word here would let a mis-provisioned key
// read as somebody's bad envelope.
const keyed = (key: Uint8Array): Uint8Array => {
  if (key.length !== ENVELOPE_KEY_BYTES) {
    throw new Error(`envelope: a key is ${ENVELOPE_KEY_BYTES} bytes, not ${key.length}`);
  }
  return key;
};

export const sealEnvelope = (key: Uint8Array, plaintext: Uint8Array): Uint8Array => {
  const version = Uint8Array.of(ENVELOPE_VERSION);
  // Never a counter: two processes share the key and would hand out one number twice, which
  // under GCM hands out the plaintexts.
  const nonce = randomBytes(ENVELOPE_NONCE_BYTES);
  const cipher = createCipheriv(ENVELOPE_AEAD, keyed(key), nonce, {
    authTagLength: ENVELOPE_TAG_BYTES,
  });
  cipher.setAAD(version);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  return new Uint8Array(Buffer.concat([version, nonce, ciphertext, cipher.getAuthTag()]));
};

export const openEnvelope = (
  key: Uint8Array,
  frame: Uint8Array,
): Result<Uint8Array, OpenEnvelopeRefusal> => {
  const opener = keyed(key);
  const version = frame.at(0);
  if (version === undefined) return err("envelope-malformed");
  // Before anything is decrypted, so a version this tier cannot read answers what is wrong
  // rather than what the tag made of it.
  if (version !== ENVELOPE_VERSION) return err("envelope-version-unknown");
  if (frame.length < SHORTEST_FRAME) return err("envelope-malformed");

  const decipher = createDecipheriv(
    ENVELOPE_AEAD,
    opener,
    frame.subarray(ENVELOPE_VERSION_BYTES, ENVELOPE_VERSION_BYTES + ENVELOPE_NONCE_BYTES),
    { authTagLength: ENVELOPE_TAG_BYTES },
  );
  decipher.setAAD(frame.subarray(0, ENVELOPE_VERSION_BYTES));
  decipher.setAuthTag(frame.subarray(frame.length - ENVELOPE_TAG_BYTES));
  const ciphertext = frame.subarray(
    ENVELOPE_VERSION_BYTES + ENVELOPE_NONCE_BYTES,
    frame.length - ENVELOPE_TAG_BYTES,
  );

  try {
    return ok(new Uint8Array(Buffer.concat([decipher.update(ciphertext), decipher.final()])));
  } catch {
    // The library says a tag did not verify by throwing, and tells nobody whether a byte moved
    // or the key was wrong.
    return err("envelope-not-authentic");
  }
};
