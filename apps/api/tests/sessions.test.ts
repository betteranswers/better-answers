import { assert, describe, expect, it } from "vitest";
import { z } from "zod";

import type { TestClient } from "./harness.ts";
import { aPersonSignedIn, aSeededSessionFor, signedInClient } from "./provoke.ts";
import { appForSuite } from "./suite-app.ts";
import { webTabOf } from "./web-client.ts";

const app = appForSuite();

const sessionIdOf = async (client: TestClient): Promise<string | null> =>
  z
    .object({ session: z.object({ id: z.string() }) })
    .nullable()
    .parse(await (await client.fetch("/get-session")).json())?.session.id ?? null;

const sessionsRead = z.array(
  z.strictObject({
    id: z.string(),
    device: z.string().min(1),
    lastActiveAt: z.iso.datetime(),
    current: z.boolean(),
  }),
);

const aSecondSessionFor = async (email: string): Promise<TestClient> =>
  signedInClient(app(), email);

describe("the person's sessions over the wire", () => {
  it("answers the read's shape, the current session first", async () => {
    const { person, client } = await aPersonSignedIn(app());
    await aSecondSessionFor(person.email);
    const { api } = await webTabOf(client);

    const held = sessionsRead.parse(await api.person.sessions.query());

    expect(held).toHaveLength(2);
    expect(held[0]?.current).toBe(true);
    expect(held.filter((session) => session.current)).toHaveLength(1);
    expect(new Set(held.map((session) => session.id)).size).toBe(2);
  });

  it("signs one session out, ending it alone", async () => {
    const { person, client } = await aPersonSignedIn(app());
    const elsewhere = await aSecondSessionFor(person.email);
    const { api } = await webTabOf(client);
    const held = sessionsRead.parse(await api.person.sessions.query());
    const other = held.find((session) => !session.current);
    assert(other !== undefined, "the second session is listed");
    const mine = await sessionIdOf(client);
    expect(mine).not.toBeNull();

    const ended = await api.person.signOutSession.mutate({ sessionId: other.id });

    expect(ended).toEqual({ ended: 1 });
    expect(await sessionIdOf(elsewhere)).toBeNull();
    expect(await sessionIdOf(client), "the current session survives").toBe(mine);
    const recorded = await app().database.superuser.query<{ detail: unknown }>(
      `SELECT detail FROM identity_audit_event
        WHERE subject_id = $1 AND action = 'people.person.sessions_ended'`,
      [person.id],
    );
    expect(recorded.rows).toHaveLength(1);
  });

  it("signs every other session out, keeping the current one", async () => {
    const { person, client } = await aPersonSignedIn(app());
    const second = await aSecondSessionFor(person.email);
    const third = await aSecondSessionFor(person.email);
    const { api } = await webTabOf(client);
    const mine = await sessionIdOf(client);
    expect(mine).not.toBeNull();

    const ended = await api.person.signOutOtherSessions.mutate();

    expect(ended).toEqual({ ended: 2 });
    for (const elsewhere of [second, third]) {
      expect(await sessionIdOf(elsewhere)).toBeNull();
    }
    expect(await sessionIdOf(client), "the current session survives").toBe(mine);
  });

  it("leaves a session past its expiry out of the read", async () => {
    const { person, client } = await aPersonSignedIn(app());
    const expired = await aSeededSessionFor(app(), person.id, {}, new Date(Date.now() - 1_000));
    const { api } = await webTabOf(client);

    const held = sessionsRead.parse(await api.person.sessions.query());

    expect(held.map((session) => session.id)).not.toContain(expired);
    expect(held).toHaveLength(1);
  });

  it("refuses a caller with no session", async () => {
    const client = app().client();
    const answered = await client.fetch("/trpc/person.sessions");

    expect(answered.status).toBe(401);
  });
});
