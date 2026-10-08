import { describe, expect, it, vi } from "vitest";

import { ulid } from "@better-answers/schema";

import type { OperatorPrincipal } from "../src/kernel/index.ts";
import {
  removeMember,
  removeMemberInput,
  endEverySignInAndTokenHere,
  endEverySignInAndTokenHereInput,
} from "../src/members/index.ts";
import { openPostgres } from "../src/store/postgres/index.ts";
import {
  addMember,
  inspectPerson,
  listPeople,
  recordSignIn,
  endEverySignInAndToken,
  setDisplayName,
} from "../src/workspaces/index.ts";
import { sessionFor } from "./identity-rows.ts";
import { heldAs } from "./members-suite.ts";
import {
  asANewOperator,
  asTheOperator,
  bootstrap,
  erasedFromTheSet,
  personIdOf,
  provisionedWorkspace,
  seedPerson,
} from "./platform.ts";
import { inputOf } from "./suite-input.ts";
import { addressOf, postgresForSuite, seedingWith } from "./suite-postgres.ts";

const db = postgresForSuite();

const listed = (search: string, page: { offset?: number; limit?: number } = {}) =>
  asTheOperator(db(), (operator, tx) =>
    listPeople(operator, tx, { search, offset: page.offset ?? 0, limit: page.limit ?? 50 }),
  );

const inspected = (personId: string) =>
  asTheOperator(db(), (operator, tx) =>
    inspectPerson(operator, tx, { personId: personIdOf(personId) }),
  );

const signInsOf = async (personId: string): Promise<readonly string[]> => {
  const found = await db().pool.query<{ at: Date }>(
    `SELECT at FROM identity_audit_event
      WHERE subject_id = $1 AND action = 'people.person.signed_in' ORDER BY at`,
    [personId],
  );
  return found.rows.map((row) => row.at.toISOString());
};

const signedIn = async (personId: string): Promise<void> => {
  const recorded = await recordSignIn(
    bootstrap,
    openPostgres(db().runtimePool),
    personId,
    "email_code",
  );
  if (!recorded.ok) throw new Error(`the sign-in was not recorded: ${String(recorded.error)}`);
};

const marker = (): string => ulid().toLowerCase();

describe("the operator's list of people", () => {
  it("names each person's workspaces, roles and latest sign-in", async () => {
    const acme = await provisionedWorkspace(db(), "Acme");
    const zenith = await provisionedWorkspace(db(), "Zenith");
    const name = `Pat ${marker()}`;
    const email = addressOf("pat");
    const personId = await seedPerson(db().pool, { name, email });
    for (const [workspace, role] of [
      [zenith, "Viewer"],
      [acme, "Editor"],
    ] as const) {
      await addMember(bootstrap, workspace.door, {
        workspaceId: workspace.workspaceId,
        email,
        role,
      });
    }
    await signedIn(personId);
    await signedIn(personId);
    await setDisplayName(bootstrap, acme.door, { personId, displayName: name });
    const [, latest] = await signInsOf(personId);

    expect(await listed(name)).toEqual({
      ok: true,
      value: {
        people: [
          {
            id: personId,
            displayName: name,
            email,
            workspaces: [
              { workspace: { id: acme.workspaceId, name: "Acme" }, role: "Editor" },
              { workspace: { id: zenith.workspaceId, name: "Zenith" }, role: "Viewer" },
            ],
            lastSignedInAt: latest,
            credentialsRevokedAt: null,
          },
        ],
        total: 1,
      },
    });
  });

  it("answers no sign-in and no workspace for a newcomer", async () => {
    const email = addressOf("newcomer");
    const personId = await seedPerson(db().pool, { email });

    expect(await listed(email)).toEqual({
      ok: true,
      value: {
        people: [
          {
            id: personId,
            displayName: "Test person",
            email,
            workspaces: [],
            lastSignedInAt: null,
            credentialsRevokedAt: null,
          },
        ],
        total: 1,
      },
    });
  });

  it("keeps the last sign-in once every session is gone", async () => {
    const email = addressOf("revoked");
    const personId = await seedPerson(db().pool, { email });
    await signedIn(personId);
    const hourAgo = new Date(Date.now() - 3_600_000);
    await sessionFor(db().pool, personId, {
      createdAt: hourAgo,
      lastUsedAt: hourAgo,
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    const revokedAt = new Date();
    const revoked = await asTheOperator(db(), (operator, tx) =>
      endEverySignInAndToken(operator, tx, { personId: personIdOf(personId), at: revokedAt }),
    );
    expect(revoked.ok).toBe(true);

    expect(await listed(email)).toMatchObject({
      ok: true,
      value: {
        people: [
          {
            id: personId,
            lastSignedInAt: (await signInsOf(personId))[0],
            credentialsRevokedAt: revokedAt.toISOString(),
          },
        ],
      },
    });
    expect(await inspected(personId)).toEqual({
      ok: true,
      value: { sessions: [], grants: [], ended: [] },
    });
  });

  it("matches a name or address as literal text, ignoring case", async () => {
    const tag = marker();
    const named = await seedPerson(db().pool, { name: `Ann ${tag}` });
    const addressed = await seedPerson(db().pool, { email: `bob-${tag}@example.invalid` });
    const underscored = await seedPerson(db().pool, { name: `a_${tag}` });
    const abutting = await seedPerson(db().pool, { name: `ab${tag}` });

    const idsOf = async (search: string) => {
      const answered = await listed(search);
      return answered.ok ? answered.value.people.map((person) => person.id).toSorted() : [];
    };

    expect(await idsOf(`  ${tag.toUpperCase()}  `)).toEqual(
      [named, addressed, underscored, abutting].toSorted(),
    );
    expect(await idsOf(`a_${tag}`)).toEqual([underscored]);
    expect(await idsOf(`%${tag}`)).toEqual([]);
  });

  it("pages the matches in name order, counting every match", async () => {
    const tag = marker();
    const [first, second, third] = [
      await seedPerson(db().pool, { name: `${tag} Cara` }),
      await seedPerson(db().pool, { name: `${tag} alex` }),
      await seedPerson(db().pool, { name: `${tag} Bea` }),
    ];

    const pageAt = async (offset: number) => {
      const answered = await listed(tag, { offset, limit: 2 });
      return answered.ok
        ? { ids: answered.value.people.map((person) => person.id), total: answered.value.total }
        : answered;
    };

    expect([await pageAt(0), await pageAt(2), await pageAt(3)]).toEqual([
      { ids: [second, third], total: 3 },
      { ids: [first], total: 3 },
      { ids: [], total: 3 },
    ]);
  });

  it("hands back the store's Error from both reads", async () => {
    const closed = await db().runtimePool.connect();
    closed.release(true);
    const operator: OperatorPrincipal = {
      kind: "operator",
      userId: personIdOf(ulid()),
      credentialIssuedAtMs: Date.now(),
    };

    expect([
      await listPeople(operator, closed, { search: "", offset: 0, limit: 50 }),
      await inspectPerson(operator, closed, { personId: personIdOf(ulid()) }),
    ]).toEqual([
      { ok: false, error: expect.any(Error) },
      { ok: false, error: expect.any(Error) },
    ]);
  });
});

describe("inspecting a person", () => {
  it("lists sessions by last use, with creation and expiry", async () => {
    const personId = await seedPerson(db().pool);
    const older = {
      createdAt: new Date("2026-09-20T09:00:00.000Z"),
      lastUsedAt: new Date("2026-09-24T09:00:00.000Z"),
      expiresAt: new Date("2026-10-01T09:00:00.000Z"),
    };
    const newer = {
      createdAt: new Date("2026-09-22T09:00:00.000Z"),
      lastUsedAt: new Date("2026-09-25T09:00:00.000Z"),
      expiresAt: new Date("2026-10-02T09:00:00.000Z"),
    };
    await sessionFor(db().pool, personId, older);
    await sessionFor(db().pool, personId, newer);
    await sessionFor(db().pool, await seedPerson(db().pool), newer);

    expect(await inspected(personId)).toEqual({
      ok: true,
      value: {
        sessions: [
          {
            createdAt: "2026-09-22T09:00:00.000Z",
            lastUsedAt: "2026-09-25T09:00:00.000Z",
            expiresAt: "2026-10-02T09:00:00.000Z",
          },
          {
            createdAt: "2026-09-20T09:00:00.000Z",
            lastUsedAt: "2026-09-24T09:00:00.000Z",
            expiresAt: "2026-10-01T09:00:00.000Z",
          },
        ],
        grants: [],
        ended: [],
      },
    });
  });

  it("folds rotated tokens, and ends a grant the server revoked", async () => {
    const acme = await provisionedWorkspace(db(), "Acme");
    const zenith = await provisionedWorkspace(db(), "Zenith");
    const personId = await seedPerson(db().pool);
    const clientId = await seedingWith(db().pool, async (seed) => {
      const client = await seed.oauthClient({ name: "Claude" });
      const token = (overrides: Parameters<typeof seed.oauthRefreshToken>[0]) =>
        seed.oauthRefreshToken({ clientId: client.clientId, userId: personId, ...overrides });
      await token({
        authorizationCodeId: "code-acme",
        referenceId: acme.workspaceId,
        createdAt: new Date("2026-09-20T09:00:00.000Z"),
        expiresAt: new Date("2026-10-20T09:00:00.000Z"),
        rotatedAt: new Date("2026-09-21T09:00:00.000Z"),
        revoked: new Date("2026-09-21T09:00:00.000Z"),
      });
      await token({
        authorizationCodeId: "code-acme",
        referenceId: acme.workspaceId,
        createdAt: new Date("2026-09-21T09:00:00.000Z"),
        expiresAt: new Date("2026-10-21T09:00:00.000Z"),
      });
      await token({
        authorizationCodeId: "code-zenith",
        referenceId: zenith.workspaceId,
        createdAt: new Date("2026-09-22T09:00:00.000Z"),
        expiresAt: new Date("2026-10-22T09:00:00.000Z"),
        revoked: new Date("2026-09-23T09:00:00.000Z"),
      });
      await seed.oauthRefreshToken({ clientId: client.clientId, referenceId: acme.workspaceId });
      return client.clientId;
    });

    expect(await inspected(personId)).toEqual({
      ok: true,
      value: {
        sessions: [],
        grants: [
          {
            assistant: { id: clientId, name: "Claude" },
            workspace: { id: acme.workspaceId, name: "Acme" },
            issuedAt: "2026-09-20T09:00:00.000Z",
            lastUsedAt: "2026-09-21T09:00:00.000Z",
            expiresAt: "2026-10-21T09:00:00.000Z",
          },
        ],
        ended: [
          {
            assistant: { id: clientId, name: "Claude" },
            workspace: { id: zenith.workspaceId, name: "Zenith" },
            issuedAt: "2026-09-22T09:00:00.000Z",
            endedAt: "2026-09-23T09:00:00.000Z",
            scope: "grant",
            endedBy: { kind: "authorization-server" },
          },
        ],
      },
    });
  });

  it("takes the unrotated token when a refresh shares its second", async () => {
    const personId = await seedPerson(db().pool);
    const second = new Date("2026-09-20T09:00:00.000Z");
    await seedingWith(db().pool, async (seed) => {
      const { clientId } = await seed.oauthClient();
      for (const [id, rotatedAt] of [
        ["refresh-a-standing", null],
        ["refresh-b-rotated", second],
      ] as const) {
        await seed.oauthRefreshToken({
          id,
          clientId,
          userId: personId,
          authorizationCodeId: `code-${personId}`,
          createdAt: second,
          rotatedAt,
          revoked: rotatedAt,
        });
      }
    });

    expect(await inspected(personId)).toMatchObject({
      ok: true,
      value: { grants: [{ issuedAt: "2026-09-20T09:00:00.000Z" }] },
    });
  });

  it("answers a grant naming no workspace with none", async () => {
    const personId = await seedPerson(db().pool);
    await seedingWith(db().pool, (seed) =>
      seed.oauthRefreshToken({
        userId: personId,
        referenceId: null,
        createdAt: new Date("2026-09-20T09:00:00.000Z"),
      }),
    );

    expect(await inspected(personId)).toMatchObject({
      ok: true,
      value: { grants: [{ workspace: null, issuedAt: "2026-09-20T09:00:00.000Z" }] },
    });
  });

  it("refuses an id no person holds", async () => {
    expect(await inspected(ulid())).toEqual({ ok: false, error: "no-such-user" });
  });
});

describe("inspecting a person's ended grants", () => {
  const ISSUED = new Date("2026-09-20T09:00:00.000Z");

  /** Newest first, as the inspection lists them. */
  const endedAtOf = async (action: string, personId: string) => {
    const found = await db().pool.query<{ at: Date }>(
      "SELECT at FROM identity_audit_event WHERE subject_id = $1 AND action = $2 ORDER BY at DESC",
      [personId, action],
    );
    return found.rows.map((row) => row.at.toISOString());
  };

  /** A member of both workspaces, with a Claude grant in each and one naming none. */
  const connectedIn = async (...workspaces: readonly { readonly workspaceId: string }[]) => {
    const personId = await seedPerson(db().pool);
    const clientId = await seedingWith(db().pool, async (seed) => {
      const client = await seed.oauthClient({ name: "Claude" });
      for (const { workspaceId } of workspaces) {
        await seed.member({ workspaceId, userId: personId, role: "Editor" });
      }
      for (const referenceId of [...workspaces.map((each) => each.workspaceId), null]) {
        await seed.oauthRefreshToken({
          clientId: client.clientId,
          userId: personId,
          referenceId,
          createdAt: ISSUED,
        });
      }
      return client.clientId;
    });
    return { personId, clientId };
  };

  /** Ada, Acme's Admin, revokes a connected member's credentials there. */
  const revokedHereByAda = async () => {
    const acme = await provisionedWorkspace(db(), "Acme", { name: "Ada Okafor" });
    const { personId } = await connectedIn(acme);
    const revoked = await heldAs(acme, acme.adminUserId, (principal, tx) =>
      endEverySignInAndTokenHere(principal, tx, {
        ...inputOf(endEverySignInAndTokenHereInput, { personId }),
        at: new Date(),
      }),
    );
    expect(revoked.ok).toBe(true);
    return { acme, personId };
  };

  const revokedEverywhere = async (personId: string) => {
    const everywhere = await asANewOperator(db(), new Date(), (operator, tx) =>
      endEverySignInAndToken(operator, tx, { personId: personIdOf(personId), at: new Date() }),
    );
    expect(everywhere.answered).toMatchObject({ ok: true, value: { ok: true } });
  };

  it("lists each, newest first, with its scope and actor", async () => {
    const acme = await provisionedWorkspace(db(), "Acme", { name: "Ada Okafor" });
    const zenith = await provisionedWorkspace(db(), "Zenith", { name: "Zoe Lin" });
    const { personId, clientId } = await connectedIn(acme, zenith);
    const bystander = await connectedIn(acme);

    for (const each of [personId, bystander.personId]) {
      const revoked = await heldAs(acme, acme.adminUserId, (principal, tx) =>
        endEverySignInAndTokenHere(principal, tx, {
          ...inputOf(endEverySignInAndTokenHereInput, { personId: each }),
          at: new Date(),
        }),
      );
      expect(revoked.ok).toBe(true);
    }
    const removed = await heldAs(zenith, zenith.adminUserId, (principal, tx) =>
      removeMember(principal, tx, { ...inputOf(removeMemberInput, { personId }), at: new Date() }),
    );
    expect(removed.ok).toBe(true);
    await revokedEverywhere(personId);

    const claude = { id: clientId, name: "Claude" };
    const issuedAt = ISSUED.toISOString();
    const [removedAt, revokedHereAt] = await endedAtOf("people.person.grants_ended", personId);
    expect(await inspected(personId)).toEqual({
      ok: true,
      value: {
        sessions: [],
        grants: [],
        ended: [
          {
            assistant: claude,
            workspace: null,
            issuedAt,
            endedAt: (await endedAtOf("people.person.credentials_revoked", personId))[0],
            scope: "everywhere",
            endedBy: { kind: "person", displayName: "Test person" },
          },
          {
            assistant: claude,
            workspace: { id: zenith.workspaceId, name: "Zenith" },
            issuedAt,
            endedAt: removedAt,
            scope: "workspace",
            endedBy: { kind: "person", displayName: "Zoe Lin" },
          },
          {
            assistant: claude,
            workspace: { id: acme.workspaceId, name: "Acme" },
            issuedAt,
            endedAt: revokedHereAt,
            scope: "workspace",
            endedBy: { kind: "person", displayName: "Ada Okafor" },
          },
        ],
      },
    });
  });

  it("orders by each action's instant, then newest issued first", async () => {
    const acme = await provisionedWorkspace(db(), "Acme");
    const personId = await seedPerson(db().pool);
    const grant = (issuedAt: string) => ({
      clientId: "https://gone.example.invalid/metadata",
      workspaceId: acme.workspaceId,
      issuedAt,
    });
    await seedingWith(db().pool, async (seed) => {
      const about = { actor: `human:${acme.adminUserId}`, subjectId: personId };
      const endedHere = (at: string, id: string, issued: readonly string[]) =>
        seed.identityAuditEvent({
          ...about,
          id,
          action: "people.person.grants_ended",
          at: new Date(at),
          detail: { workspaceId: acme.workspaceId, grants: issued.map(grant) },
        });
      await endedHere("2026-09-25T10:00:00.000Z", "01A00000000000000000000000", [
        "2026-09-01T09:00:00.000Z",
        "2026-09-02T09:00:00.000Z",
      ]);
      await endedHere("2026-09-24T10:00:00.000Z", "01ZZZZZZZZZZZZZZZZZZZZZZZZ", [
        "2026-08-01T09:00:00.000Z",
      ]);
      await seed.identityAuditEvent({
        ...about,
        action: "people.person.credentials_revoked",
        at: new Date("2026-09-26T10:00:00.000Z"),
        detail: {},
      });
    });

    const read = await inspected(personId);

    expect(read.ok ? read.value.ended.map((each) => [each.endedAt, each.issuedAt]) : []).toEqual([
      ["2026-09-25T10:00:00.000Z", "2026-09-02T09:00:00.000Z"],
      ["2026-09-25T10:00:00.000Z", "2026-09-01T09:00:00.000Z"],
      ["2026-09-24T10:00:00.000Z", "2026-08-01T09:00:00.000Z"],
    ]);
    expect(read.ok ? read.value.ended[0] : undefined).toMatchObject({
      assistant: {
        id: "https://gone.example.invalid/metadata",
        name: "https://gone.example.invalid/metadata",
      },
      workspace: { id: acme.workspaceId, name: "Acme" },
      scope: "workspace",
    });
  });

  it("names a workspace gone since by its id", async () => {
    const personId = await seedPerson(db().pool);
    const gone = ulid();
    const clientId = await seedingWith(db().pool, async (seed) => {
      const client = await seed.oauthClient({ name: "Claude" });
      await seed.identityAuditEvent({
        actor: "process:better-answers-test",
        subjectId: personId,
        action: "people.person.credentials_revoked",
        detail: {
          grants: [
            { clientId: client.clientId, workspaceId: gone, issuedAt: ISSUED.toISOString() },
          ],
        },
      });
      return client.clientId;
    });

    expect(await inspected(personId)).toMatchObject({
      ok: true,
      value: {
        ended: [
          {
            assistant: { id: clientId, name: "Claude" },
            workspace: { id: gone, name: gone },
            scope: "everywhere",
            endedBy: { kind: "platform" },
          },
        ],
      },
    });
  });

  it("never scopes the operator's transaction to a workspace", async () => {
    const { personId } = await revokedHereByAda();

    const read = await asTheOperator(db(), async (operator, tx) => {
      const queries = vi.spyOn(tx, "query");
      const answered = await inspectPerson(operator, tx, { personId: personIdOf(personId) });
      const statements = queries.mock.calls.map(([statement]) => String(statement));
      queries.mockRestore();
      const scope = await tx.query<{ scope: string | null }>(
        "SELECT current_workspace_id() AS scope",
      );
      return { answered, statements, scope: scope.rows[0]?.scope };
    });

    expect(read).toMatchObject({ answered: { ok: true, value: { ended: [{}] } }, scope: null });
    expect(read.statements.length).toBeGreaterThan(0);
    expect(read.statements.filter((each) => /app\.workspace_id|set_config/.test(each))).toEqual([]);
  });

  it("names a former member who ended one as such", async () => {
    const { acme, personId } = await revokedHereByAda();
    await erasedFromTheSet(db(), acme.workspaceId, acme.adminUserId);

    expect(await inspected(personId)).toMatchObject({
      ok: true,
      value: { ended: [{ endedBy: { kind: "former-member" } }] },
    });
  });
  /** A grant whose standing token the authorization server marked, at sign-out or at `/oauth2/revoke`. */
  const endedByTheServer = async (personId: string, issued: Date, ended: Date) =>
    seedingWith(db().pool, async (seed) => {
      const client = await seed.oauthClient({ name: "Claude" });
      await seed.oauthRefreshToken({
        clientId: client.clientId,
        userId: personId,
        referenceId: null,
        createdAt: issued,
        revoked: ended,
      });
      return client.clientId;
    });

  it("orders the server's ending among the actions' by its instant", async () => {
    const personId = await seedPerson(db().pool);
    await endedByTheServer(
      personId,
      new Date("2026-09-10T09:00:00.000Z"),
      new Date("2026-09-24T10:00:00.000Z"),
    );
    await seedingWith(db().pool, async (seed) => {
      for (const at of ["2026-09-25T10:00:00.000Z", "2026-09-23T10:00:00.000Z"]) {
        await seed.identityAuditEvent({
          subjectId: personId,
          action: "people.person.credentials_revoked",
          at: new Date(at),
          detail: {
            grants: [
              {
                clientId: "https://gone.example.invalid/metadata",
                workspaceId: null,
                issuedAt: ISSUED.toISOString(),
              },
            ],
          },
        });
      }
    });

    const read = await inspected(personId);

    expect(read.ok ? read.value.ended.map((each) => [each.endedAt, each.endedBy]) : []).toEqual([
      ["2026-09-25T10:00:00.000Z", { kind: "platform" }],
      ["2026-09-24T10:00:00.000Z", { kind: "authorization-server" }],
      ["2026-09-23T10:00:00.000Z", { kind: "platform" }],
    ]);
  });

  it("leaves a server-ended grant out of a later revocation", async () => {
    const personId = await seedPerson(db().pool);
    const clientId = await endedByTheServer(personId, ISSUED, new Date("2026-09-21T09:00:00.000Z"));
    const endedBy = { kind: "authorization-server" } as const;
    expect(await inspected(personId)).toMatchObject({
      ok: true,
      value: { grants: [], ended: [{ assistant: { id: clientId }, scope: "grant", endedBy }] },
    });

    await revokedEverywhere(personId);

    const read = await inspected(personId);
    expect(
      read.ok ? read.value.ended.filter((each) => each.assistant.id === clientId) : [],
    ).toEqual([]);
    const recorded = await db().pool.query<{ detail: unknown }>(
      "SELECT detail FROM identity_audit_event WHERE subject_id = $1 AND action = $2",
      [personId, "people.person.credentials_revoked"],
    );
    expect(recorded.rows).toEqual([{ detail: { grants: [] } }]);
  });
});
