import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";

import { createTokenVerifier } from "../src/auth/index.ts";

/**
 * The bearer verifier through its interface: the audience check is ours (research 80
 * row 24 — the SDK never wires it), so a token minted for another resource, by another
 * issuer, expired, or without the surface's claims is refused, and a rotated key is
 * read once more before a token is turned away.
 */

const ISSUER = "https://mcp.example.test";
const AUDIENCE = `${ISSUER}/mcp`;

const keyed = async () => {
  const { privateKey, publicKey } = await generateKeyPair("EdDSA", { crv: "Ed25519" });
  const jwk = {
    ...(await exportJWK(publicKey)),
    kid: `kid-${Math.random().toString(36).slice(2)}`,
    alg: "EdDSA",
  };
  return { privateKey, jwk };
};

const mint = async (
  privateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"],
  kid: string,
  claims: Record<string, unknown>,
  options: { issuer?: string; audience?: string; expiresIn?: string } = {},
) =>
  new SignJWT({
    scope: "knowledge:read feedback:write",
    user: "user-1",
    workspace: "01J6AAAAAAAAAAAAAAAAAAAAAA",
    ...claims,
  })
    .setProtectedHeader({ alg: "EdDSA", kid })
    .setIssuer(options.issuer ?? ISSUER)
    .setAudience(options.audience ?? AUDIENCE)
    .setSubject("user-1")
    .setJti("jti-1")
    .setIssuedAt()
    .setExpirationTime(options.expiresIn ?? "1h")
    .sign(privateKey);

describe("the bearer verifier", () => {
  it("accepts a token this issuer minted for this audience and hands back its claims", async () => {
    const key = await keyed();
    const verifier = createTokenVerifier({
      issuer: ISSUER,
      audience: AUDIENCE,
      jwks: async () => ({ keys: [key.jwk] }),
    });

    const info = await verifier.verifyAccessToken(await mint(key.privateKey, key.jwk.kid, {}));

    expect(info.scopes).toEqual(["knowledge:read", "feedback:write"]);
    expect(info.resource?.href).toBe(AUDIENCE);
    expect(info.extra).toMatchObject({
      tokenId: "jti-1",
      claims: { workspaceId: "01J6AAAAAAAAAAAAAAAAAAAAAA", userId: "user-1" },
    });
  });

  it.each([
    ["another audience", { audience: "https://other.example/mcp" }],
    ["another issuer", { issuer: "https://other.example" }],
    ["an expired token", { expiresIn: "-1s" }],
  ])("refuses %s", async (_case, options) => {
    const key = await keyed();
    const verifier = createTokenVerifier({
      issuer: ISSUER,
      audience: AUDIENCE,
      jwks: async () => ({ keys: [key.jwk] }),
    });

    await expect(
      verifier.verifyAccessToken(await mint(key.privateKey, key.jwk.kid, {}, options)),
    ).rejects.toMatchObject({
      code: "invalid_token",
    });
  });

  it("refuses a token signed by a key the issuer never published", async () => {
    const published = await keyed();
    const rogue = await keyed();
    const verifier = createTokenVerifier({
      issuer: ISSUER,
      audience: AUDIENCE,
      jwks: async () => ({ keys: [published.jwk] }),
    });

    await expect(
      verifier.verifyAccessToken(await mint(rogue.privateKey, rogue.jwk.kid, {})),
    ).rejects.toMatchObject({
      code: "invalid_token",
    });
  });

  it("refuses a token that names no workspace", async () => {
    const key = await keyed();
    const verifier = createTokenVerifier({
      issuer: ISSUER,
      audience: AUDIENCE,
      jwks: async () => ({ keys: [key.jwk] }),
    });

    await expect(
      verifier.verifyAccessToken(await mint(key.privateKey, key.jwk.kid, { workspace: null })),
    ).rejects.toMatchObject({
      code: "invalid_token",
    });
  });

  it("reads the key set once more when a token names a kid it has not seen — a rotation", async () => {
    const first = await keyed();
    const second = await keyed();
    let published = [first.jwk];
    let reads = 0;
    const verifier = createTokenVerifier({
      issuer: ISSUER,
      audience: AUDIENCE,
      jwks: async () => {
        reads += 1;
        return { keys: published };
      },
    });
    await verifier.verifyAccessToken(await mint(first.privateKey, first.jwk.kid, {}));

    published = [first.jwk, second.jwk];
    await verifier.verifyAccessToken(await mint(second.privateKey, second.jwk.kid, {}));

    expect(reads).toBe(2);
  });
});
