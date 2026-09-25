import { describe, expect, it } from "vitest";

import { ULID, ulid } from "@better-answers/schema";

import { signIn } from "./flow.ts";
import { appForSuite } from "./suite-app.ts";

const app = appForSuite();

const isPlatformId = (value: string | undefined): boolean =>
  value !== undefined && ULID.test(value);

const anAddress = () => `${ulid().toLowerCase()}@example.invalid`;

describe("the id a person gets", () => {
  it("mints a new person's user id in the platform's shape", async () => {
    const email = anAddress();

    await signIn(app(), app().client(), email);

    const row = await app().database.superuser.query<{ id: string }>(
      'SELECT id FROM "user" WHERE email = $1',
      [email],
    );
    expect(isPlatformId(row.rows[0]?.id)).toBe(true);
  });

  it("gives that person's session an id in the same shape", async () => {
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

  it("gives a workspace's first Admin membership the same id shape", async () => {
    const workspace = await app().provision({ name: "Acme" });

    const row = await app().database.superuser.query<{ id: string }>(
      "SELECT id FROM member WHERE workspace_id = $1 AND user_id = $2",
      [workspace.workspaceId, workspace.admin.id],
    );
    expect(isPlatformId(row.rows[0]?.id)).toBe(true);
  });
});

describe("an invitation read by its id", () => {
  it("refuses the invited person until their email is verified", async () => {
    const acme = await app().provision({ name: "Acme" });
    const email = anAddress();
    const client = app().client();
    await signIn(app(), client, email);
    const invited = await app().invite({
      workspaceId: acme.workspaceId,
      email,
      inviterId: acme.admin.id,
    });

    await app().setEmailVerified(email, false);
    const refused = await client.fetch(`/organization/get-invitation?id=${invited.id}`);
    expect(refused.status).toBe(403);

    await app().setEmailVerified(email, true);
    const read = await client.fetch(`/organization/get-invitation?id=${invited.id}`);
    expect(read.status).toBe(200);
  });
});
