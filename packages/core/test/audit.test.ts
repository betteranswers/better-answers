import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, expectTypeOf, it } from "vitest";

import { FAMILIES, ulid } from "@better-answers/schema";

import {
  act,
  type ActName,
  declarations,
  declareActs,
  declareIdentitySetActs,
  record,
  recordFor,
} from "../src/audit/index.ts";
import type { ActorId, PlatformPrincipal, UserPrincipal } from "../src/kernel/index.ts";
import {
  openPostgres,
  withIdentityWrite,
  withPrincipal,
  withScope,
  type PostgresDoor,
} from "../src/store/postgres/index.ts";
import { loadEveryEntryPoint } from "./entry-points.ts";
import { asANewOperator, bootstrap, principalOf, provisionedWorkspace } from "./platform.ts";
import { coreSourceFiles, sourceTreeIsInstrumented } from "./source-tree.ts";
import { postgresForSuite } from "./suite-postgres.ts";

const db = postgresForSuite();

const actLiteralsIn = (files: readonly string[]): Set<string> =>
  new Set(
    files.flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(/\bact\(\s*"([a-z_.]+)"/g)].map(
        (match) => match[1] ?? "",
      ),
    ),
  );

const declaredActNames = () => declarations().flatMap((declaration) => declaration.acts);

const provisioned = () => provisionedWorkspace(db(), "Audited");

const writingIn =
  (door: PostgresDoor, workspaceId: string) => (event: Parameters<typeof record>[2]) =>
    withScope(bootstrap, door, workspaceId, (tx) => record(bootstrap, tx, event));

const rowById = async (id: string) => {
  const found = await db().pool.query<{
    workspace_id: string;
    act: string;
    family: string;
    actor: string;
    subject_kind: string;
    subject_id: string;
    detail: Record<string, string | number | boolean>;
    batch_id: string | null;
  }>(
    "SELECT workspace_id, act, family, actor, subject_kind, subject_id, detail, batch_id FROM audit_event WHERE id = $1",
    [id],
  );
  return found.rows[0];
};

describe("the declared-acts walk", () => {
  it("holds every slice's acts to the four families by prefix", async () => {
    await loadEveryEntryPoint();
    const walked = declarations();
    expect(walked.length).toBeGreaterThan(0);

    for (const declaration of walked) {
      expect({ family: declaration.family, known: FAMILIES.includes(declaration.family) }).toEqual({
        family: declaration.family,
        known: true,
      });

      for (const name of declaration.acts) {
        expect({ name, prefix: name.split(".")[0] }).toEqual({ name, prefix: declaration.family });
      }
    }
  });

  it.skipIf(sourceTreeIsInstrumented())(
    "reaches every act declared in the tree, and no other",
    async () => {
      await loadEveryEntryPoint();
      const registered = new Set<string>(declaredActNames());
      const inTree = actLiteralsIn(coreSourceFiles());
      const inThisSuite = actLiteralsIn([path.resolve(import.meta.dirname, "audit.test.ts")]);

      expect([...inTree].filter((name) => !registered.has(name))).toEqual([]);
      expect([...registered].filter((name) => !inTree.has(name) && !inThisSuite.has(name))).toEqual(
        [],
      );
      expect(inTree.size).toBeGreaterThan(0);
    },
  );

  it("answers the act's name and its rows' detail shape", () => {
    expect(act("platform.probe.shaped", { adminUserId: "id", confirmed: "flag" })).toEqual({
      name: "platform.probe.shaped",
      detail: { adminUserId: "id", confirmed: "flag" },
    });
  });

  it("registers exactly the acts given and hands them back", () => {
    const registered = declareActs("platform", {
      accepted: act("platform.probe.accepted", { confirmed: "flag" }),
    });

    expect(registered).toEqual({
      accepted: { name: "platform.probe.accepted", detail: { confirmed: "flag" } },
    });
    expect(declarations()).toContainEqual({
      family: "platform",
      acts: ["platform.probe.accepted"],
    });
  });

  it("refuses an act declared under a family not its prefix", () => {
    expect(() =>
      // @ts-expect-error — the runtime half of what the type already refuses.
      declareActs("platform", { added: act("people.member.added", {}) }),
    ).toThrow(/not a platform act/);
  });

  it("refuses a fifth family, in the type and at runtime", () => {
    expectTypeOf<"billing.invoice.sent">().not.toExtend<ActName>();
    expect(() =>
      // @ts-expect-error — the family set is the one closed list.
      declareActs("billing", { sent: act("billing.invoice.sent", {}) }),
    ).toThrow(/not a billing act/);
  });

  it("refuses an act whose subject is never an audit event", () => {
    const neverASubject = [
      "run",
      "answer_audit",
      "signal",
      "alert",
      "spend",
      "llm_call",
      "backup_run",
      "health_check",
      "inbox",
    ];
    for (const subject of neverASubject) {
      expect(() =>
        declareActs("platform", { probe: act(`platform.${subject}.started`, {}) }),
      ).toThrow(/never an audit event/);
    }
  });

  it("registers nothing when one act of a declaration is refused", () => {
    expect(() =>
      declareActs("platform", {
        fine: act("platform.probe.atomic", {}),
        refused: act("platform.run.started", {}),
      }),
    ).toThrow(/never an audit event/);
    expect(declaredActNames()).not.toContain("platform.probe.atomic");
  });

  it("refuses an act declared twice, so each has one slice", () => {
    declareActs("platform", { first: act("platform.probe.twice", {}) });
    expect(() => declareActs("platform", { again: act("platform.probe.twice", {}) })).toThrow(
      /declared twice/,
    );
  });

  it("refuses an act named twice in one declaration, declaring none", () => {
    expect(() =>
      declareActs("platform", {
        one: act("platform.probe.doubled", {}),
        two: act("platform.probe.doubled", {}),
        other: act("platform.probe.beside", {}),
      }),
    ).toThrow("audit: platform.probe.doubled is declared twice");
    expect(declaredActNames()).not.toContain("platform.probe.doubled");
    expect(declaredActNames()).not.toContain("platform.probe.beside");
    expect(() =>
      declareActs("platform", { once: act("platform.probe.doubled", {}) }),
    ).not.toThrow();
  });

  it.skipIf(sourceTreeIsInstrumented())(
    "finds no door call wrapped in attempt anywhere in core",
    () => {
      const wrapped =
        /attempt\(\s*(?:async\s+)?\(\s*\)\s*=>\s*(?:\{(?:(?!with[A-Z])[^])*?)?(?:return\s+)?(?:await\s+|void\s+)?record(?:For)?\(/;

      expect(wrapped.test("attempt(() => record(principal, tx, event))")).toBe(true);
      expect(wrapped.test("attempt(async () => recordFor(platform, tx, event))")).toBe(true);
      expect(
        wrapped.test("attempt(async () => {\n  return await record(principal, tx, event);\n})"),
      ).toBe(true);
      expect(wrapped.test("attempt(() => {\n  void record(principal, tx, event);\n})")).toBe(true);
      expect(
        wrapped.test(
          "attempt(async () => {\n  const before = prepare();\n  return record(before, tx, event);\n})",
        ),
      ).toBe(true);

      expect(
        wrapped.test(
          "attempt(() => withScope(platform, door, id, (tx) => record(platform, tx, event)))",
        ),
      ).toBe(false);
      expect(
        wrapped.test(
          "attempt(async () => {\n  return withPrincipal(door, claims, (principal, tx) => record(principal, tx, event));\n})",
        ),
      ).toBe(false);

      const offending = coreSourceFiles().filter((file) =>
        wrapped.test(readFileSync(file, "utf8")),
      );
      expect(offending).toEqual([]);
    },
  );
});

const PROBE = declareActs("platform", {
  written: act("platform.probe.written", { adminUserId: "id", role: "role", confirmed: "flag" }),
  noted: act("platform.probe.noted", { confirmed: "flag" }),

  optional: act("platform.probe.optional", { adminUserId: "id?", confirmed: "flag" }),
});

describe("the first door — record, the actor from the Principal", () => {
  it("lands a person's row booked to them, the id verbatim", async () => {
    const { door, workspaceId, adminUserId } = await provisioned();
    const id = ulid();

    const written = await withPrincipal(
      door,
      { workspaceId, userId: adminUserId, issuedAt: new Date() },
      (principal, tx) =>
        record(principal, tx, {
          id,
          act: PROBE.written,
          subjectId: adminUserId,
          detail: { adminUserId, role: "Editor", confirmed: true },
        }),
    );

    expect(written).toEqual({
      ok: true,
      value: { id, actorId: `human:${adminUserId}` },
    });
    expect(await rowById(id)).toEqual({
      workspace_id: workspaceId,
      act: "platform.probe.written",
      family: "platform",
      actor: `human:${adminUserId}`,
      subject_kind: "probe",
      subject_id: adminUserId,
      detail: { adminUserId, role: "Editor", confirmed: true },
      batch_id: null,
    });
  });

  it("lands the platform's batched row in the scoped workspace", async () => {
    const { door, workspaceId } = await provisioned();
    const id = ulid();
    const batchId = ulid();

    const written = await withScope(bootstrap, door, workspaceId, (tx) =>
      record(bootstrap, tx, {
        id,
        act: PROBE.noted,
        subjectId: ulid(),
        detail: { confirmed: true },
        batchId,
      }),
    );

    expect(written).toEqual({ id, actorId: "process:better-answers-bootstrap" });
    expect(await rowById(id)).toMatchObject({
      workspace_id: workspaceId,
      actor: "process:better-answers-bootstrap",
      detail: { confirmed: true },
      batch_id: batchId,
    });
  });

  it("lands nothing for the platform outside a workspace scope", async () => {
    const { door } = await provisioned();
    const id = ulid();

    await expect(
      withScope(bootstrap, door, "", (tx) =>
        record(bootstrap, tx, {
          id,
          act: PROBE.noted,
          subjectId: ulid(),
          detail: { confirmed: true },
        }),
      ),
    ).rejects.toThrow(/row-level security|null value/);
    expect(await rowById(id)).toBeUndefined();
  });

  it("writes the person's own workspace, refusing a scope elsewhere", async () => {
    const here = await provisioned();
    const there = await provisionedWorkspace(db(), "Elsewhere");

    const theirs = principalOf(there.workspaceId, there.adminUserId, "Admin");
    const refused = ulid();
    const landed = ulid();
    const noteAs = (scope: string, id: string) =>
      withScope(bootstrap, here.door, scope, (tx) =>
        record(theirs, tx, {
          id,
          act: PROBE.noted,
          subjectId: there.workspaceId,
          detail: { confirmed: true },
        }),
      );

    await expect(noteAs(here.workspaceId, refused)).rejects.toThrow(/row-level security/);
    expect(await rowById(refused)).toBeUndefined();

    await noteAs(there.workspaceId, landed);
    expect(await rowById(landed)).toMatchObject({
      workspace_id: there.workspaceId,
      actor: `human:${there.adminUserId}`,
    });
  });

  it("lands a row with its optional field and one without", async () => {
    const { door, workspaceId, adminUserId } = await provisioned();
    const named = ulid();
    const left = ulid();

    await withScope(bootstrap, door, workspaceId, (tx) =>
      record(bootstrap, tx, {
        id: named,
        act: PROBE.optional,
        subjectId: adminUserId,
        detail: { adminUserId, confirmed: true },
      }),
    );
    await withScope(bootstrap, door, workspaceId, (tx) =>
      record(bootstrap, tx, {
        id: left,
        act: PROBE.optional,
        subjectId: adminUserId,
        detail: { confirmed: true },
      }),
    );

    expect(await rowById(named)).toMatchObject({ detail: { adminUserId, confirmed: true } });
    expect(await rowById(left)).toMatchObject({ detail: { confirmed: true } });
  });

  it("rejects missing fields and an email for an optional id", async () => {
    const { door, workspaceId, adminUserId } = await provisioned();
    const write = writingIn(door, workspaceId);

    await expect(
      write({
        id: ulid(),
        act: PROBE.optional,
        subjectId: adminUserId,

        detail: { adminUserId },
      }),
    ).rejects.toThrow(/detail is missing the field confirmed/);
    await expect(
      write({
        id: ulid(),
        act: PROBE.optional,
        subjectId: adminUserId,
        detail: { adminUserId: "priya@example.invalid", confirmed: true },
      }),
    ).rejects.toThrow(/adminUserId is not an id, or absent/);
  });

  it("rejects a detail naming a field the act does not", async () => {
    const { door, workspaceId, adminUserId } = await provisioned();
    const id = ulid();

    await expect(
      withScope(bootstrap, door, workspaceId, (tx) =>
        record(bootstrap, tx, {
          id,
          act: PROBE.noted,
          // @ts-expect-error — the act names `confirmed` and nothing else; the runtime half.
          detail: { confirmed: true, email: "priya@example.invalid" },
          subjectId: adminUserId,
        }),
      ),
    ).rejects.toThrow(/names a field the act does not: email/);
    expect(await rowById(id)).toBeUndefined();
  });

  it("rejects email ids, missing fields, undeclared acts and unminted ids", async () => {
    const { door, workspaceId, adminUserId } = await provisioned();
    const write = writingIn(door, workspaceId);

    await expect(
      write({
        id: ulid(),
        act: PROBE.written,
        subjectId: adminUserId,
        detail: { adminUserId: "priya@example.invalid", role: "Admin", confirmed: true },
      }),
      // The end anchor tells this message from the optional kind's, which is this plus ", or
      // absent"; unanchored, both read green.
    ).rejects.toThrow(/adminUserId is not an id$/);
    await expect(
      write({
        id: ulid(),
        act: PROBE.written,
        subjectId: adminUserId,

        detail: { adminUserId, role: "Admin" },
      }),
    ).rejects.toThrow(/detail is missing the field confirmed/);
    await expect(
      write({
        id: ulid(),
        act: act("platform.probe.undeclared", {}),
        subjectId: adminUserId,
        detail: {},
      }),
    ).rejects.toThrow(/never declared/);

    await expect(
      write({
        id: "audit-1",
        act: PROBE.noted,
        subjectId: adminUserId,
        detail: { confirmed: true },
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining("refused at the boundary"),
      cause: expect.objectContaining({ issues: expect.any(Array) }),
    });
  });
});

describe("the second door — recordFor, the platform naming the actor", () => {
  it("books the row to the named actor, not the platform", async () => {
    const { door, workspaceId } = await provisioned();
    const id = ulid();

    const requester: ActorId = `human:${ulid()}`;

    const written = await withScope(bootstrap, door, workspaceId, (tx) =>
      recordFor(bootstrap, tx, {
        id,
        actor: requester,
        act: PROBE.noted,
        subjectId: workspaceId,
        detail: { confirmed: true },
      }),
    );

    expect(written).toEqual({ id, actorId: requester });
    expect(await rowById(id)).toMatchObject({ actor: requester, workspace_id: workspaceId });
  });

  it("is unreachable from a user principal, by type alone", () => {
    expectTypeOf(recordFor).parameter(0).toEqualTypeOf<PlatformPrincipal>();
    expectTypeOf<UserPrincipal>().not.toExtend<PlatformPrincipal>();
  });
});

const IDENTITY_PROBE = declareIdentitySetActs("platform", {
  noted: act("platform.probe.identity_noted", { confirmed: "flag" }),
});

const identityRowById = async (id: string) => {
  const found = await db().pool.query(
    "SELECT act, family, actor, subject_kind, subject_id, detail, batch_id FROM identity_audit_event WHERE id = $1",
    [id],
  );
  return found.rows[0];
};

describe("the identity-set audit log, reached through either door", () => {
  it("books the platform's row to its named actor, outside workspaces", async () => {
    const door = openPostgres(db().runtimePool);
    const id = ulid();
    const personId = ulid();

    const written = await withIdentityWrite(bootstrap, door, (tx) =>
      recordFor(bootstrap, tx, {
        id,
        actor: `human:${personId}`,
        act: IDENTITY_PROBE.noted,
        subjectId: personId,
        detail: { confirmed: true },
      }),
    );

    expect(written).toEqual({ id, actorId: `human:${personId}` });
    expect(await identityRowById(id)).toEqual({
      act: "platform.probe.identity_noted",
      family: "platform",
      actor: `human:${personId}`,
      subject_kind: "probe",
      subject_id: personId,
      detail: { confirmed: true },
      batch_id: null,
    });
    expect(await rowById(id)).toBeUndefined();
  });

  it("lands a person's row here, outside their workspace's audit log", async () => {
    const { door, workspaceId, adminUserId } = await provisioned();
    const id = ulid();

    await withPrincipal(
      door,
      { workspaceId, userId: adminUserId, issuedAt: new Date() },
      (principal, tx) =>
        record(principal, tx, {
          id,
          act: IDENTITY_PROBE.noted,
          subjectId: adminUserId,
          detail: { confirmed: false },
        }),
    );

    expect(await identityRowById(id)).toMatchObject({
      actor: `human:${adminUserId}`,
      subject_id: adminUserId,
    });
    expect(await rowById(id)).toBeUndefined();
  });

  it("books the operator's row to the operator's own person", async () => {
    const id = ulid();

    const { operatorId } = await asANewOperator(db(), new Date(), (operator, tx) =>
      record(operator, tx, {
        id,
        act: IDENTITY_PROBE.noted,
        subjectId: operator.userId,
        detail: { confirmed: true },
      }),
    );

    expect(await identityRowById(id)).toMatchObject({
      actor: `human:${operatorId}`,
      subject_id: operatorId,
    });
    expect(await rowById(id)).toBeUndefined();
  });

  it("refuses a workspace's act under the operator, who has none", async () => {
    const id = ulid();

    const writing = asANewOperator(db(), new Date(), (operator, tx) =>
      record(operator, tx, {
        id,
        act: PROBE.noted,
        subjectId: operator.userId,
        detail: { confirmed: true },
      }),
    );

    await expect(writing).rejects.toThrow(
      'new row violates row-level security policy for table "audit_event"',
    );
    expect(await rowById(id)).toBeUndefined();
  });

  it("holds the detail to the act's declared shape", async () => {
    const door = openPostgres(db().runtimePool);
    const id = ulid();

    await expect(
      withIdentityWrite(bootstrap, door, (tx) =>
        recordFor(bootstrap, tx, {
          id,
          actor: `human:${ulid()}`,
          act: IDENTITY_PROBE.noted,
          subjectId: ulid(),
          // @ts-expect-error — the act names `confirmed` and nothing else; the runtime half.
          detail: { confirmed: true, name: "Priya Shah" },
        }),
      ),
    ).rejects.toThrow(/names a field the act does not: name/);
    expect(await identityRowById(id)).toBeUndefined();
  });

  it("stamps a row as written only where the event asks", async () => {
    const door = openPostgres(db().runtimePool);
    const [unstamped, stamped] = [ulid(), ulid()];
    const event = (id: string) => ({
      id,
      actor: `human:${ulid()}` as const,
      act: IDENTITY_PROBE.noted,
      subjectId: ulid(),
      detail: { confirmed: true },
    });

    const began = await withIdentityWrite(bootstrap, door, async (tx) => {
      await recordFor(bootstrap, tx, event(unstamped));
      await tx.query("SELECT pg_sleep(0.01)");
      await recordFor(bootstrap, tx, { ...event(stamped), stampedAsWritten: true });
      return (await tx.query<{ at: Date }>("SELECT now() AS at")).rows[0]?.at;
    });

    const found = await db().pool.query<{ id: string; at: Date }>(
      "SELECT id, at FROM identity_audit_event WHERE id = ANY($1)",
      [[unstamped, stamped]],
    );
    const atOf = (id: string) => found.rows.find((row) => row.id === id)?.at.getTime();
    expect(atOf(unstamped)).toBe(began?.getTime());
    expect(atOf(stamped)).toBeGreaterThanOrEqual((began?.getTime() ?? 0) + 10);
  });

  it("registers an identity-set act once, among the declared acts", () => {
    expect(declarations()).toContainEqual({
      family: "platform",
      acts: ["platform.probe.identity_noted"],
    });
    expect(() =>
      declareIdentitySetActs("platform", { again: act("platform.probe.identity_noted", {}) }),
    ).toThrow(/declared twice/);
  });
});
