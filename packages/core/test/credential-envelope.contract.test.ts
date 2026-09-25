import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  ENVELOPE_AEAD,
  ENVELOPE_KEY_BYTES,
  ENVELOPE_NONCE_BYTES,
  ENVELOPE_TAG_BYTES,
  ENVELOPE_VERSION,
  ENVELOPE_VERSION_BYTES,
  openEnvelope,
  sealEnvelope,
} from "../src/kernel/index.ts";
import { contractFixture } from "./contract-fixture.ts";

const hex = z.string().regex(/^(?:[0-9a-f]{2})*$/);

const fixture = contractFixture(
  "credential-envelope",
  z.object({
    description: z.string(),
    aead: z.string().min(1),
    version: z.int().nonnegative(),
    frame: z.object({
      key_bytes: z.int().positive(),
      version_bytes: z.int().positive(),
      nonce_bytes: z.int().positive(),
      tag_bytes: z.int().positive(),
    }),
    key: hex,
    opens: z.array(z.object({ name: z.string(), why: z.string(), frame: hex, plaintext: hex })),
    refuses: z.array(
      z.object({ name: z.string(), why: z.string(), frame: hex, refusal: z.string().min(1) }),
    ),
  }),
);

const bytes = (written: string): Uint8Array => new Uint8Array(Buffer.from(written, "hex"));

const key = bytes(fixture.key);

describe("credential-envelope, the format a sealed credential is written in", () => {
  it("names the cipher, version and widths the agreement names", () => {
    expect({
      aead: ENVELOPE_AEAD,
      version: ENVELOPE_VERSION,
      key_bytes: ENVELOPE_KEY_BYTES,
      version_bytes: ENVELOPE_VERSION_BYTES,
      nonce_bytes: ENVELOPE_NONCE_BYTES,
      tag_bytes: ENVELOPE_TAG_BYTES,
    }).toEqual({
      aead: fixture.aead,
      version: fixture.version,
      key_bytes: fixture.frame.key_bytes,
      version_bytes: fixture.frame.version_bytes,
      nonce_bytes: fixture.frame.nonce_bytes,
      tag_bytes: fixture.frame.tag_bytes,
    });
  });

  it("uses the fixture's own key, of the agreement's width", () => {
    expect(key.length).toBe(fixture.frame.key_bytes);
  });

  it("opens every frame the agreement carries to its exact plaintext", () => {
    expect(fixture.opens.length).toBeGreaterThan(0);

    for (const vector of fixture.opens) {
      expect({ name: vector.name, opened: openEnvelope(key, bytes(vector.frame)) }).toEqual({
        name: vector.name,
        opened: { ok: true, value: bytes(vector.plaintext) },
      });
    }
  });

  it("refuses every frame the agreement refuses, in the agreement's word", () => {
    expect(fixture.refuses.length).toBeGreaterThan(0);

    for (const vector of fixture.refuses) {
      expect({ name: vector.name, opened: openEnvelope(key, bytes(vector.frame)) }).toEqual({
        name: vector.name,
        opened: { ok: false, error: vector.refusal },
      });
    }
  });

  it("carries a refused frame for each word and no other", () => {
    expect(new Set(fixture.refuses.map((vector) => vector.refusal))).toEqual(
      new Set(["envelope-version-unknown", "envelope-malformed", "envelope-not-authentic"]),
    );
  });

  it("writes a frame of the agreement's widths, version first", () => {
    for (const vector of fixture.opens) {
      const plaintext = bytes(vector.plaintext);
      const sealed = sealEnvelope(key, plaintext);

      expect({ name: vector.name, version: sealed.at(0), length: sealed.length }).toEqual({
        name: vector.name,
        version: fixture.version,
        length:
          fixture.frame.version_bytes +
          fixture.frame.nonce_bytes +
          plaintext.length +
          fixture.frame.tag_bytes,
      });
    }
  });

  it("recovers a plaintext it sealed itself, byte for byte", () => {
    for (const vector of fixture.opens) {
      const plaintext = bytes(vector.plaintext);

      expect({
        name: vector.name,
        opened: openEnvelope(key, sealEnvelope(key, plaintext)),
      }).toEqual({ name: vector.name, opened: { ok: true, value: plaintext } });
    }
  });

  it("draws a fresh nonce for every seal", () => {
    for (const vector of fixture.opens) {
      const plaintext = bytes(vector.plaintext);
      const sealed = new Set(
        Array.from({ length: 16 }, () => Buffer.from(sealEnvelope(key, plaintext)).toString("hex")),
      );

      expect({ name: vector.name, distinct: sealed.size }).toEqual({
        name: vector.name,
        distinct: 16,
      });
    }
  });

  it("throws on a key of another length rather than refusing", () => {
    const short = key.subarray(1);

    expect(() => sealEnvelope(short, key)).toThrow(/envelope: a key is/);
    for (const vector of fixture.opens) {
      expect(() => openEnvelope(short, bytes(vector.frame))).toThrow(/envelope: a key is/);
    }
  });
});
