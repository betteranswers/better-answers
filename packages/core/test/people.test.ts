import { describe, expect, it } from "vitest";

import { ulid } from "@better-answers/schema";

import type { OperatorPrincipal } from "../src/kernel/index.ts";
import { openPostgres } from "../src/store/postgres/index.ts";
import {
  addMember,
  inspectPerson,
  listPeople,
  recordSignIn,
  revokeCredentials,
  setDisplayName,
} from "../src/workspaces/index.ts";
import { sessionFor } from "./identity-rows.ts";
import {
  asTheOperator,
  bootstrap,
  personIdOf,
  provisionedWorkspace,
  seedPerson,
} from "./platform.ts";
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
      WHERE subject_id = $1 AND act = 'people.person.signed_in' ORDER BY at`,
    [personId],
  );
  return found.rows.map((row) => row.at.toISOString());
};

const signedIn = async (personId: string): Promise<void> => {
  const recorded = await recordSignIn(bootstrap, openPostgres(db().runtimePool), personId);
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
            memberships: [
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
            memberships: [],
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
      revokeCredentials(operator, tx, { personId: personIdOf(personId), at: revokedAt }),
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
    expect(await inspected(personId)).toEqual({ ok: true, value: { sessions: [], grants: [] } });
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
      },
    });
  });

  it("folds a grant's rotated refresh tokens into one standing grant", async () => {
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
            client: { id: clientId, name: "Claude" },
            workspace: { id: zenith.workspaceId, name: "Zenith" },
            issuedAt: "2026-09-22T09:00:00.000Z",
            lastUsedAt: "2026-09-22T09:00:00.000Z",
            expiresAt: "2026-10-22T09:00:00.000Z",
            revokedAt: "2026-09-23T09:00:00.000Z",
          },
          {
            client: { id: clientId, name: "Claude" },
            workspace: { id: acme.workspaceId, name: "Acme" },
            issuedAt: "2026-09-20T09:00:00.000Z",
            lastUsedAt: "2026-09-21T09:00:00.000Z",
            expiresAt: "2026-10-21T09:00:00.000Z",
            revokedAt: null,
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
      value: { grants: [{ issuedAt: "2026-09-20T09:00:00.000Z", revokedAt: null }] },
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
