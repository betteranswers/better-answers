import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";

import { createTokenVerifier } from "../src/auth/index.ts";

const ISSUER = "https://app.example.test";
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

const verifierPublishing = (
  ...keys: readonly Awaited<ReturnType<typeof keyed>>["jwk"][]
): ReturnType<typeof createTokenVerifier> =>
  createTokenVerifier({
    issuer: ISSUER,
    audience: AUDIENCE,
    jwks: async () => ({ keys: [...keys] }),
  });

const refusalOf = async (
  verifier: ReturnType<typeof createTokenVerifier>,
  token: string,
): Promise<unknown> =>
  verifier.verifyAccessToken(token).then(
    () => undefined,
    (thrown: unknown) => thrown,
  );

describe("the bearer verifier", () => {
  it("accepts this issuer's token for this audience, returning its claims", async () => {
    const key = await keyed();
    const verifier = verifierPublishing(key.jwk);

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

    expect(
      await refusalOf(
        verifierPublishing(key.jwk),
        await mint(key.privateKey, key.jwk.kid, {}, options),
      ),
    ).toMatchObject({
      code: "invalid_token",
    });
  });

  it("refuses a token signed by an unpublished key", async () => {
    const published = await keyed();
    const rogue = await keyed();

    expect(
      await refusalOf(
        verifierPublishing(published.jwk),
        await mint(rogue.privateKey, rogue.jwk.kid, {}),
      ),
    ).toMatchObject({
      code: "invalid_token",
    });
  });

  it("refuses a token that names no workspace", async () => {
    const key = await keyed();

    expect(
      await refusalOf(
        verifierPublishing(key.jwk),
        await mint(key.privateKey, key.jwk.kid, { workspace: null }),
      ),
    ).toMatchObject({
      code: "invalid_token",
    });
  });

  it("rereads the key set once for an unseen kid", async () => {
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
