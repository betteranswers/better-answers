import { describe, expect, it } from "vitest";

import { signIn } from "./flow.ts";
import { appForSuite } from "./suite-app.ts";

const app = appForSuite();

describe("the delete-user endpoint, to a person who is signed in", () => {
  it("refuses them, leaving their user row and membership in place", async () => {
    const acme = await app().provision({ name: "Acme" });
    const client = app().client();
    await signIn(app(), client, acme.admin.email);

    const session = await client.fetch("/get-session");
    expect(session.status).toBe(200);

    const deleted = await client.json("/delete-user", {});
    expect(deleted.status).toBe(404);

    const person = await app().database.superuser.query<{ id: string }>(
      'SELECT id FROM "user" WHERE id = $1',
      [acme.admin.id],
    );
    const membership = await app().database.superuser.query<{ user_id: string }>(
      "SELECT user_id FROM member WHERE workspace_id = $1 AND user_id = $2",
      [acme.workspaceId, acme.admin.id],
    );
    expect({ person: person.rowCount, membership: membership.rowCount }).toEqual({
      person: 1,
      membership: 1,
    });
  });
});
