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
import { bootstrap, principalOf, provisionedWorkspace } from "./platform.ts";
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

const provisioned = () => provisionedWorkspace(db(), "Ledger");

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
  it("holds every slice's acts to the four families, the prefix checked both ways", async () => {
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
    "reaches every act declared in the tree, and every act it reached is declared in the tree",
    async () => {
      await loadEveryEntryPoint();
      const registered = new Set<string>(declarations().flatMap((declaration) => declaration.acts));
      const inTree = actLiteralsIn(coreSourceFiles());
      const inThisSuite = actLiteralsIn([path.resolve(import.meta.dirname, "audit.test.ts")]);

      expect([...inTree].filter((name) => !registered.has(name))).toEqual([]);
      expect([...registered].filter((name) => !inTree.has(name) && !inThisSuite.has(name))).toEqual(
        [],
      );
      expect(inTree.size).toBeGreaterThan(0);
    },
  );

  it("answers the act it was handed — its name and the shape of the detail every row carries", () => {
    expect(act("platform.probe.shaped", { adminUserId: "id", confirmed: "flag" })).toEqual({
      name: "platform.probe.shaped",
      detail: { adminUserId: "id", confirmed: "flag" },
    });
  });

  it("registers exactly the acts it was given, and hands them back to the slice", () => {
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

  it("refuses an act declared under a family that is not its first word", () => {
    expect(() =>
      // @ts-expect-error — the runtime half of what the type already refuses.
      declareActs("platform", { added: act("people.member.added", {}) }),
    ).toThrow(/not a platform act/);
  });

  it("refuses a fifth family, in the type and at the row", () => {
    expectTypeOf<"billing.invoice.sent">().not.toExtend<ActName>();
    expect(() =>
      // @ts-expect-error — the family set is the one closed list.
      declareActs("billing", { sent: act("billing.invoice.sent", {}) }),
    ).toThrow(/not a billing act/);
  });

  it("refuses an act whose subject names a record that is never a ledger row", () => {
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
      ).toThrow(/never a ledger row/);
    }
  });

  it("registers nothing when one act of a declaration is refused", () => {
    expect(() =>
      declareActs("platform", {
        fine: act("platform.probe.atomic", {}),
        refused: act("platform.run.started", {}),
      }),
    ).toThrow(/never a ledger row/);
    expect(declarations().flatMap((declaration) => declaration.acts)).not.toContain(
      "platform.probe.atomic",
    );
  });

  it("refuses an act declared twice, so an act belongs to one slice", () => {
    declareActs("platform", { first: act("platform.probe.twice", {}) });
    expect(() => declareActs("platform", { again: act("platform.probe.twice", {}) })).toThrow(
      /declared twice/,
    );
  });

  it.skipIf(sourceTreeIsInstrumented())(
    "finds no door call wrapped in attempt anywhere in the tree",
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

describe("the first door — record, the actor derived from the Principal", () => {
  it("lands a row with the supplied id verbatim under a user principal, booked to the person", async () => {
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

  it("lands the platform's row in the workspace the transaction is scoped to, with its batch id", async () => {
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

  it("lands nothing for the platform outside a workspace scope — the ledger is a tenant table", async () => {
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

  it("writes the person's own workspace on the row, so a transaction scoped elsewhere is refused", async () => {
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

  it("lands a row whose optional field is given, and one the act left it out of", async () => {
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

  it("rejects a required field the detail leaves out, and an optional one holding an email", async () => {
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

  it("rejects a detail that names a field the act does not, before any row exists", async () => {
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

  it("rejects an id-kind field holding an email, a detail short of a field, an act nobody declared, and an id not the minter's", async () => {
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
  it("lands a row booked to the actor named, not to the platform", async () => {
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

  it("is not reachable from a user principal: the type refuses it, and the type is the one guard", () => {
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

describe("the identity-set ledger — an act on the identity set, through either door", () => {
  it("lands the platform's row booked to the actor it names, in no workspace's ledger", async () => {
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

  it("lands a person's row there from a workspace's transaction too, never in that workspace's ledger", async () => {
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

  it("holds the detail to the act's declared shape, as a workspace's ledger does", async () => {
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

  it("registers an identity-set act among the declared acts, so it is one slice's and declared once", () => {
    expect(declarations()).toContainEqual({
      family: "platform",
      acts: ["platform.probe.identity_noted"],
    });
    expect(() =>
      declareIdentitySetActs("platform", { again: act("platform.probe.identity_noted", {}) }),
    ).toThrow(/declared twice/);
  });
});
