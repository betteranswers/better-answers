import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { signIn } from "./flow.ts";
import { startApp, type TestApp } from "./harness.ts";

/**
 * The guard `[SEC3]` asks for beside a privilege the platform does not grant: Better
 * Auth's delete-user feature stays unconfigured, and this is the test of what that
 * refuses (T-063 spec, *Two guards and one move*).
 *
 * It matters because of what a delete would take with it. The user row is the person id
 * every record names a person by (ADR 0035); `member.user_id` is a foreign key to it, so
 * a delete either cascades through a workspace's memberships or fails on them, and the
 * ledger T-059 founds would be left naming an actor that no longer exists. Ending what a
 * person holds is *revoke credentials*, in its two scopes, and erasing what is about
 * them is the erasure routine's pseudonymisation (ADR 0020, ADR 0035) — neither is a
 * row disappearing at the person's own request.
 *
 * The endpoint is mounted (`better-auth-endpoints.txt` lists `/delete-user` and its
 * callback), so the refusal is the configuration's rather than a route that is missing —
 * which is why the proof is a request a signed-in person makes and not an assertion
 * about the option. The 404 was checked against the installed library and against its
 * opposite: turning the feature on makes this endpoint answer 200 and this test red,
 * which is what a guard test has to be able to do. The emailed callback is not asserted
 * separately because it answers 404 either way — an assertion that cannot disagree with
 * the code is not a test; what closes that road is this option staying off.
 */

let app: TestApp;

beforeAll(async () => {
  app = await startApp();
}, 180_000);

afterAll(async () => {
  await app.stop();
});

describe("the delete-user endpoint, to a person who is signed in", () => {
  it("refuses them, and leaves their user row and their membership where they are", async () => {
    const acme = await app.provision({ name: "Acme" });
    const client = app.client();
    await signIn(app, client, acme.admin.email);

    // The same client, on the same cookie: a session Better Auth answers for. So the
    // refusal below cannot be read as "not signed in".
    const session = await client.fetch("/get-session");
    expect(session.status).toBe(200);

    const deleted = await client.json("/delete-user", {});
    expect(deleted.status).toBe(404);

    const person = await app.database.superuser.query<{ id: string }>(
      'SELECT id FROM "user" WHERE id = $1',
      [acme.admin.id],
    );
    const membership = await app.database.superuser.query<{ user_id: string }>(
      "SELECT user_id FROM member WHERE workspace_id = $1 AND user_id = $2",
      [acme.workspaceId, acme.admin.id],
    );
    expect({ person: person.rowCount, membership: membership.rowCount }).toEqual({
      person: 1,
      membership: 1,
    });
  });
});
