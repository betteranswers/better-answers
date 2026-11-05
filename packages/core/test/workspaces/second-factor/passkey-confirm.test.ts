import { describe, expect, it } from "vitest";

import {
  keepPasskeyChallenge,
  readPasskeyCredentials,
  takePasskeyChallenge,
} from "../../../src/workspaces/index.ts";
import { passkeyFor } from "../../support/identity-rows.ts";
import { bootstrap, seedPerson } from "../../support/platform.ts";
import { AT, secondFactorSuite } from "./second-factor-suite.ts";

const { db, door, aSession } = secondFactorSuite();

const after = (seconds: number): Date => new Date(AT.getTime() + seconds * 1000);

const keeping = (personId: string, sessionId: string, challenge: string) =>
  keepPasskeyChallenge(bootstrap, door(), { personId, sessionId, challenge, now: AT });

const taking = (sessionId: string, now = AT) =>
  takePasskeyChallenge(bootstrap, door(), { sessionId, now });

const aPersonInASession = async () => {
  const personId = await seedPerson(db().pool);
  return { personId, sessionId: await aSession(personId) };
};

describe("the challenge for a passkey confirmation", () => {
  it("can be taken once, by the session that requested it", async () => {
    const { personId, sessionId } = await aPersonInASession();
    expect(await keeping(personId, sessionId, "first")).toEqual({ ok: true, value: undefined });

    expect(await taking(sessionId)).toEqual({ ok: true, value: "first" });
    expect(await taking(sessionId)).toEqual({ ok: true, value: undefined });
  });

  it("returns only the session's latest challenge", async () => {
    const { personId, sessionId } = await aPersonInASession();
    await keeping(personId, sessionId, "first");
    await keeping(personId, sessionId, "second");

    expect(await taking(sessionId)).toEqual({ ok: true, value: "second" });
  });

  it("returns nothing after five minutes", async () => {
    const { personId, sessionId } = await aPersonInASession();
    await keeping(personId, sessionId, "first");

    expect(await taking(sessionId, after(301))).toEqual({ ok: true, value: undefined });
  });

  it("is never stored under another person's session", async () => {
    const { personId } = await aPersonInASession();
    const stranger = await aPersonInASession();

    expect(await keeping(personId, stranger.sessionId, "first")).toEqual({
      ok: false,
      error: "session-gone",
    });
    expect(await taking(stranger.sessionId)).toEqual({ ok: true, value: undefined });
  });
});

describe("a person's passkey credentials", () => {
  it("returns only the person's own, with numeric counters", async () => {
    const { personId } = await aPersonInASession();
    const passkeyId = await passkeyFor(db().pool, personId);
    await passkeyFor(db().pool, (await aPersonInASession()).personId);

    expect(await readPasskeyCredentials(bootstrap, door(), { personId })).toEqual({
      ok: true,
      value: [
        {
          credentialId: `credential-${passkeyId}`,
          publicKey: "public-key",
          counter: 0,
          transports: null,
        },
      ],
    });
  });

  it("refuses a malformed person id", async () => {
    expect(await readPasskeyCredentials(bootstrap, door(), { personId: "not an id" })).toEqual({
      ok: false,
      error: "malformed",
    });
  });
});
