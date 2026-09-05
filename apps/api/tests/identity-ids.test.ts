import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ULID_PATTERN, ulid } from "@better-answers/schema";

import { signIn } from "./flow.ts";
import { startApp, type TestApp } from "./harness.ts";

/**
 * One id shape, proved where a person actually gets one (ADR 0035): through the HTTP
 * surface, on rows Better Auth wrote for itself. Nothing here reaches into the library's
 * configuration — a test that read the option back would only prove the option was set,
 * not that anything downstream of it obeyed.
 */

let app: TestApp;

beforeAll(async () => {
  app = await startApp();
}, 180_000);

afterAll(async () => {
  await app.stop();
});

const isPlatformId = (value: string | undefined): boolean =>
  value !== undefined && new RegExp(ULID_PATTERN).test(value);

const anAddress = () => `${ulid().toLowerCase()}@example.invalid`;

describe("the id a person gets", () => {
  it("gives a person signing in for the first time a user id in the one shape the platform mints", async () => {
    const email = anAddress();

    await signIn(app, app.client(), email);

    const row = await app.database.superuser.query<{ id: string }>(
      'SELECT id FROM "user" WHERE email = $1',
      [email],
    );
    expect(isPlatformId(row.rows[0]?.id)).toBe(true);
  });

  it("gives that person's browser session an id in the same shape", async () => {
    const email = anAddress();

    await signIn(app, app.client(), email);

    const row = await app.database.superuser.query<{ id: string }>(
      'SELECT s.id FROM session s JOIN "user" u ON u.id = s.user_id WHERE u.email = $1',
      [email],
    );
    expect(isPlatformId(row.rows[0]?.id)).toBe(true);
  });

  it("gives a provisioned workspace's first Admin membership an id in the same shape", async () => {
    const workspace = await app.provision({ name: "Acme" });

    const row = await app.database.superuser.query<{ id: string }>(
      "SELECT id FROM member WHERE workspace_id = $1 AND user_id = $2",
      [workspace.workspaceId, workspace.admin.id],
    );
    expect(isPlatformId(row.rows[0]?.id)).toBe(true);
  });
});

describe("an invitation read by its id", () => {
  /** A pending invitation as the People screen will one day write one (T-027). */
  const seedInvitation = async (workspaceId: string, email: string, inviterId: string) => {
    const id = ulid();
    await app.database.superuser.query(
      "INSERT INTO invitation (id, workspace_id, email, role, status, expires_at, inviter_id) VALUES ($1, $2, $3, 'Viewer', 'pending', now() + interval '7 days', $4)",
      [id, workspaceId, email, inviterId],
    );
    return id;
  };

  it("is refused to the invited person until their email is verified, and read once it is", async () => {
    const acme = await app.provision({ name: "Acme" });
    const email = anAddress();
    const client = app.client();
    await signIn(app, client, email);
    const invitationId = await seedInvitation(acme.workspaceId, email, acme.admin.id);

    // The same person, their address no longer verified: the sign-in code proved the
    // address once, and this is what the platform does when that proof is withdrawn.
    await app.database.superuser.query(
      'UPDATE "user" SET email_verified = false WHERE email = $1',
      [email],
    );
    const refused = await client.fetch(`/organization/get-invitation?id=${invitationId}`);
    expect(refused.status).toBe(403);

    await app.database.superuser.query('UPDATE "user" SET email_verified = true WHERE email = $1', [
      email,
    ]);
    const read = await client.fetch(`/organization/get-invitation?id=${invitationId}`);
    expect(read.status).toBe(200);
  });
});
