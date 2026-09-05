import { describe, expect, it } from "vitest";

import { ULID, ulid } from "@better-answers/schema";

import { signIn } from "./flow.ts";
import { appForSuite } from "./suite-app.ts";

/**
 * One id shape, proved where a person actually gets one (ADR 0035): through the HTTP
 * surface, on rows Better Auth wrote for itself. Nothing here reaches into the library's
 * configuration — a test that read the option back would only prove the option was set,
 * not that anything downstream of it obeyed.
 */

const app = appForSuite();

const isPlatformId = (value: string | undefined): boolean =>
  value !== undefined && ULID.test(value);

const anAddress = () => `${ulid().toLowerCase()}@example.invalid`;

describe("the id a person gets", () => {
  it("gives a person signing in for the first time a user id in the one shape the platform mints", async () => {
    const email = anAddress();

    await signIn(app(), app().client(), email);

    const row = await app().database.superuser.query<{ id: string }>(
      'SELECT id FROM "user" WHERE email = $1',
      [email],
    );
    expect(isPlatformId(row.rows[0]?.id)).toBe(true);
  });

  it("gives that person's browser session an id in the same shape", async () => {
    // Six lines the test above also has: a person signs in and one row Better Auth wrote
    // for them is read back. Carried rather than folded, because the row and the statement
    // that finds it are the case, and a helper taking a query is the query with a wrapper
    // round it.
    /* jscpd:ignore-start */
    const email = anAddress();

    await signIn(app(), app().client(), email);

    const row = await app().database.superuser.query<{ id: string }>(
      'SELECT s.id FROM session s JOIN "user" u ON u.id = s.user_id WHERE u.email = $1',
      [email],
    );
    expect(isPlatformId(row.rows[0]?.id)).toBe(true);
    /* jscpd:ignore-end */
  });

  it("gives a provisioned workspace's first Admin membership an id in the same shape", async () => {
    const workspace = await app().provision({ name: "Acme" });

    const row = await app().database.superuser.query<{ id: string }>(
      "SELECT id FROM member WHERE workspace_id = $1 AND user_id = $2",
      [workspace.workspaceId, workspace.admin.id],
    );
    expect(isPlatformId(row.rows[0]?.id)).toBe(true);
  });
});

describe("an invitation read by its id", () => {
  it("is refused to the invited person until their email is verified, and read once it is", async () => {
    const acme = await app().provision({ name: "Acme" });
    const email = anAddress();
    const client = app().client();
    await signIn(app(), client, email);
    const invited = await app().invite({
      workspaceId: acme.workspaceId,
      email,
      inviterId: acme.admin.id,
    });

    // The same person, their address no longer proved: the sign-in code proved it once,
    // and this is the state a person is in before they have answered any code at all.
    await app().setEmailVerified(email, false);
    const refused = await client.fetch(`/organization/get-invitation?id=${invited.id}`);
    expect(refused.status).toBe(403);

    await app().setEmailVerified(email, true);
    const read = await client.fetch(`/organization/get-invitation?id=${invited.id}`);
    expect(read.status).toBe(200);
  });
});
