import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startApp, type TestApp } from "./harness.ts";
import { webSignedIn } from "./web-client.ts";

let app: TestApp;

// A file of its own, so no person in its database carries the operator mark.
beforeAll(async () => {
  app = await startApp();
});

afterAll(async () => {
  await app.stop();
});

describe("a platform where no person carries the operator mark", () => {
  it("answers alike and keeps the flag, logging the missing operator", async () => {
    const workspace = await app.provision();
    const flagged = await app.person(undefined, "Rude Name");
    await app.addMember(workspace.workspaceId, flagged.id, "Editor");
    const { api } = await webSignedIn(app, workspace.admin.email);

    const answered = await api.members.flagDisplayName.mutate({ personId: flagged.id });

    expect(answered).toEqual({ personId: flagged.id, sentToTheOperator: true });
    const raised = await app.database.superuser.query(
      "SELECT 1 FROM identity_audit_event WHERE subject_id = $1 AND act = 'people.name_flag.raised'",
      [flagged.id],
    );
    expect(raised.rowCount).toBe(1);
    expect(app.emails.filter((message) => message.text.includes(flagged.id))).toEqual([]);
    expect(app.logs).toContainEqual(
      expect.objectContaining({
        level: 50,
        event: "trpc.email_failed",
        person_id: flagged.id,
        msg: "no person carries the operator mark, so the name flag was not emailed",
      }),
    );
  });
});
