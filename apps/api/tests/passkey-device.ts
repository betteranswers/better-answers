import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";

import { isoBase64URL, isoCBOR } from "@simplewebauthn/server/helpers";
import { z } from "zod";

/** WebAuthn's authenticator-data flags: user present, user verified, credential data attached. */
const USER_PRESENT = 0x01;
const USER_VERIFIED = 0x04;
const CREDENTIAL_ATTACHED = 0x40;

/** COSE's labels for an ES256 key on P-256, the one a platform authenticator makes. */
const COSE = { kty: 1, alg: 3, crv: -1, x: -2, y: -3, ec2: 2, es256: -7, p256: 1 } as const;

const options = z.object({ challenge: z.string() });

const publicJwk = z.object({ x: z.string(), y: z.string() });

const sha256 = (data: Uint8Array | string): Uint8Array<ArrayBuffer> =>
  new Uint8Array(createHash("sha256").update(data).digest());

const concat = (...parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> =>
  new Uint8Array(Buffer.concat(parts));

const uint32 = (value: number): Uint8Array<ArrayBuffer> => {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value);
  return bytes;
};

const uint16 = (value: number): Uint8Array<ArrayBuffer> => {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value);
  return bytes;
};

const coseKeyOf = (publicKey: KeyObject): Uint8Array => {
  const jwk = publicJwk.parse(publicKey.export({ format: "jwk" }));
  return isoCBOR.encode(
    new Map<number, number | Uint8Array>([
      [COSE.kty, COSE.ec2],
      [COSE.alg, COSE.es256],
      [COSE.crv, COSE.p256],
      [COSE.x, isoBase64URL.toBuffer(jwk.x)],
      [COSE.y, isoBase64URL.toBuffer(jwk.y)],
    ]),
  );
};

type Ceremony = { readonly verified?: boolean };

/**
 * A platform authenticator in software: one P-256 key for one site, answering the options the
 * api hands out as a browser's `navigator.credentials` would.
 */
export const aPasskeyDevice = (origin: string) => {
  const rpIdHash = sha256(new URL(origin).hostname);
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const credentialId = new Uint8Array(randomBytes(16));
  const id = isoBase64URL.fromBuffer(credentialId);

  const flagsOf = (ceremony: Ceremony, extra = 0): number =>
    USER_PRESENT | (ceremony.verified === false ? 0 : USER_VERIFIED) | extra;

  const clientData = (
    type: "webauthn.create" | "webauthn.get",
    asked: unknown,
  ): Uint8Array<ArrayBuffer> =>
    new TextEncoder().encode(
      JSON.stringify({
        type,
        challenge: options.parse(asked).challenge,
        origin,
        crossOrigin: false,
      }),
    );

  return {
    credentialId: id,

    /** What `startRegistration` hands back: an attestation of format "none". */
    create(asked: unknown, ceremony: Ceremony = {}) {
      const authData = concat(
        rpIdHash,
        Uint8Array.of(flagsOf(ceremony, CREDENTIAL_ATTACHED)),
        uint32(0),
        new Uint8Array(16),
        uint16(credentialId.length),
        credentialId,
        coseKeyOf(publicKey),
      );
      const attestationObject = isoCBOR.encode(
        new Map<string, string | Uint8Array | Map<string, never>>([
          ["fmt", "none"],
          ["attStmt", new Map<string, never>()],
          ["authData", authData],
        ]),
      );
      return {
        id,
        rawId: id,
        type: "public-key",
        response: {
          clientDataJSON: isoBase64URL.fromBuffer(clientData("webauthn.create", asked)),
          attestationObject: isoBase64URL.fromBuffer(attestationObject),
          transports: ["internal"],
        },
        clientExtensionResults: {},
        authenticatorAttachment: "platform",
      };
    },

    /** What `startAuthentication` hands back: an assertion signed over the challenge. */
    get(asked: unknown, ceremony: Ceremony = {}) {
      const authenticatorData = concat(rpIdHash, Uint8Array.of(flagsOf(ceremony)), uint32(0));
      const clientDataJSON = clientData("webauthn.get", asked);
      const signature = sign(
        "sha256",
        concat(authenticatorData, sha256(clientDataJSON)),
        privateKey,
      );
      return {
        id,
        rawId: id,
        type: "public-key",
        response: {
          clientDataJSON: isoBase64URL.fromBuffer(clientDataJSON),
          authenticatorData: isoBase64URL.fromBuffer(authenticatorData),
          signature: isoBase64URL.fromBuffer(new Uint8Array(signature)),
        },
        clientExtensionResults: {},
        authenticatorAttachment: "platform",
      };
    },
  };
};

export type PasskeyDevice = ReturnType<typeof aPasskeyDevice>;
