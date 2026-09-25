import { describe, expect, it } from "vitest";

import { openPostgres } from "../src/store/postgres/index.ts";
import { recordConsent, recordSignIn } from "../src/workspaces/index.ts";
import { bootstrap, provisionedWorkspace, seedPerson } from "./platform.ts";
import { postgresForSuite } from "./suite-postgres.ts";

const db = postgresForSuite();

const CLIENT_ID = "https://claude.ai/oauth/mcp-oauth-client-metadata";

const ULID_SHAPE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

const identitySetRowsFor = async (personId: string) =>
  (
    await db().pool.query(
      `SELECT id, act, family, actor, subject_kind, subject_id, detail, batch_id
         FROM identity_audit_event WHERE subject_id = $1`,
      [personId],
    )
  ).rows;

const consentRowsBy = async (personId: string) =>
  (
    await db().pool.query(
      `SELECT workspace_id, act, family, actor, subject_kind, subject_id, detail
         FROM audit_event WHERE actor = $1`,
      [`human:${personId}`],
    )
  ).rows;

describe("recording a sign-in", () => {
  it("writes one identity-set row, the person its actor and subject", async () => {
    const personId = await seedPerson(db().pool);
    const door = openPostgres(db().runtimePool);

    const recorded = await recordSignIn(bootstrap, door, personId);

    expect(recorded).toEqual({ ok: true, value: undefined });
    expect(await identitySetRowsFor(personId)).toEqual([
      {
        id: expect.stringMatching(ULID_SHAPE),
        act: "people.person.signed_in",
        family: "people",
        actor: `human:${personId}`,
        subject_kind: "person",
        subject_id: personId,
        detail: {},
        batch_id: null,
      },
    ]);
    expect(await consentRowsBy(personId)).toEqual([]);
  });

  it("refuses a malformed person id, writing nothing", async () => {
    const door = openPostgres(db().runtimePool);

    const recorded = await recordSignIn(bootstrap, door, "not-a-person-id");

    expect(recorded).toEqual({ ok: false, error: "malformed" });
    expect(await identitySetRowsFor("not-a-person-id")).toEqual([]);
  });
});

describe("recording a consent", () => {
  it("writes one row to the workspace, the client its subject", async () => {
    const named = await provisionedWorkspace(db(), "Consented");
    const personId = await seedPerson(db().pool);

    const recorded = await recordConsent(bootstrap, named.door, {
      personId,
      workspaceId: named.workspaceId,
      clientId: CLIENT_ID,
    });

    expect(recorded).toEqual({ ok: true, value: undefined });
    expect(await consentRowsBy(personId)).toEqual([
      {
        workspace_id: named.workspaceId,
        act: "people.client.consented",
        family: "people",
        actor: `human:${personId}`,
        subject_kind: "client",
        subject_id: CLIENT_ID,
        detail: {},
      },
    ]);
    expect(await identitySetRowsFor(personId)).toEqual([]);
  });

  it.each([
    ["person id", { personId: "not-a-person-id", workspaceId: undefined }],
    ["workspace id", { personId: undefined, workspaceId: "not-a-workspace-id" }],
  ])("refuses a malformed %s, writing nothing", async (_case, malformed) => {
    const { door, workspaceId } = await provisionedWorkspace(db(), "Refused");
    const personId = await seedPerson(db().pool);

    const recorded = await recordConsent(bootstrap, door, {
      personId: malformed.personId ?? personId,
      workspaceId: malformed.workspaceId ?? workspaceId,
      clientId: CLIENT_ID,
    });

    expect(recorded).toEqual({ ok: false, error: "malformed" });
    expect(await consentRowsBy(personId)).toEqual([]);
  });
});
