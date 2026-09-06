import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { type MigratedPostgres, startMigratedPostgres } from "@better-answers/schema/testing";
import { afterAll, beforeAll, describe, expect, expectTypeOf, it } from "vitest";

import { boundarySchemas, FAMILIES, ulid } from "@better-answers/schema";

import {
  act,
  type ActName,
  declarations,
  declareActs,
  record,
  recordFor,
} from "../src/audit/index.ts";
import type { ActorId, UserPrincipal } from "../src/kernel/index.ts";
import { openPostgres, withPrincipal, withScope } from "../src/store/postgres/index.ts";
import { provisionWorkspace } from "../src/workspaces/index.ts";
import { bootstrap, seedPerson } from "./platform.ts";

/**
 * The ledger through the audit slice's entry point (`[TEST1]`), against real Postgres:
 * the vocabulary a slice declares against, the walk over every slice's declared acts, and
 * the two doors — each proved to land a row with the supplied id verbatim, booked to the
 * actor the door derives or names, in the workspace the transaction is scoped to.
 */

let db: MigratedPostgres;

beforeAll(async () => {
  db = await startMigratedPostgres();
}, 120_000);

afterAll(async () => {
  await db.stop();
});

const CORE_SRC = path.resolve(import.meta.dirname, "../src");
const PACKAGE_JSON = path.resolve(import.meta.dirname, "../package.json");

/** Every module the exports map names, loaded — so every slice's declarations have run. */
const loadEveryEntryPoint = async (): Promise<void> => {
  const manifest: { exports: Readonly<Record<string, string>> } = JSON.parse(
    readFileSync(PACKAGE_JSON, "utf8"),
  );
  for (const relative of Object.values(manifest.exports)) {
    const file = pathToFileURL(path.resolve(path.dirname(PACKAGE_JSON), relative)).href;
    await import(/* @vite-ignore */ file);
  }
};

/** Every act name written as `act("…")` in the files given. */
const actLiteralsIn = (files: readonly string[]): Set<string> =>
  new Set(
    files.flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(/\bact\(\s*"([a-z_.]+)"/g)].map(
        (match) => match[1] ?? "",
      ),
    ),
  );

const sourceFiles = (): string[] =>
  readdirSync(CORE_SRC, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => path.join(entry.parentPath, entry.name));

/** A provisioned workspace and its Admin, as a user principal's claims. */
const provisioned = async () => {
  const adminUserId = await seedPerson(db.pool);
  const door = openPostgres(db.runtimePool);
  const workspaceId = ulid();
  const made = await provisionWorkspace(bootstrap, door, {
    id: workspaceId,
    name: "Ledger",
    slug: `ledger-${workspaceId.toLowerCase()}`,
    adminUserId,
  });
  expect(made.ok).toBe(true);
  return { door, workspaceId, adminUserId };
};

const rowById = async (id: string) => {
  const found = await db.pool.query<{
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
      // One way: the family a slice declared under is one of the four.
      expect({ family: declaration.family, known: FAMILIES.includes(declaration.family) }).toEqual({
        family: declaration.family,
        known: true,
      });
      // The other: every act's first word is that family, and nothing else's.
      for (const name of declaration.acts) {
        expect({ name, prefix: name.split(".")[0] }).toEqual({ name, prefix: declaration.family });
      }
    }
  });

  it("reaches every act declared in the tree, and every act it reached is declared in the tree", async () => {
    // `[TEST7]`: an act declared in a file its slice's entry point never imports would be
    // one the walk cannot see; a registration no source names would be one nobody can read.
    // Held by name, both ways, with this suite's own probe declarations counted in.
    await loadEveryEntryPoint();
    const registered = new Set<string>(declarations().flatMap((declaration) => declaration.acts));
    const inTree = actLiteralsIn(sourceFiles());
    const inThisSuite = actLiteralsIn([path.resolve(import.meta.dirname, "audit.test.ts")]);

    expect([...inTree].filter((name) => !registered.has(name))).toEqual([]);
    expect([...registered].filter((name) => !inTree.has(name) && !inThisSuite.has(name))).toEqual(
      [],
    );
    expect(inTree.size).toBeGreaterThan(0);
  });

  it("refuses an act declared under a family that is not its first word", () => {
    expect(() =>
      // @ts-expect-error — a people act cannot be declared as a platform act; held at
      // compile time first, and this is the runtime half for a caller without the compiler.
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
    // Runs, the answer audit, signals, alerts, spend and its rows, backup runs, health
    // checks and the inbox are their own records; a declaration naming one is refused
    // before any row could exist.
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
    // A slice's declaration is one act of its own: the first name must not become
    // writable while the second is refused and the whole is invisible to the walk.
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

  it("finds no door call wrapped in attempt anywhere in the tree", () => {
    // `[AUDIT1]`: the doors are called bare, so a door's rejection aborts the caller's
    // transaction. `attempt(() => record(...))` would hand the abort back as a value
    // the act might not read, and the act would commit without its event. The regex
    // refuses the direct wrap in its spellings — braced or not, `return`/`await`/`void`
    // before the call, statements ahead of it — and stops at a `with…` opener, because
    // `attempt(() => withScope(… => record(…)))` is the sanctioned shape: there the
    // door is bare inside the opener, and the abort still fails the whole attempt.
    // The deep hold is `[AUDIT1]`'s per-slice fail-together test, not this pattern.
    const wrapped =
      /attempt\(\s*(?:async\s+)?\(\s*\)\s*=>\s*(?:\{(?:(?!with[A-Z])[^])*?)?(?:return\s+)?(?:await\s+|void\s+)?record(?:For)?\(/;
    // The pattern is proved to bite before its silence is read as innocence.
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
    // And proved to pass the sanctioned shape, so the guard cannot outlaw the convention.
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

    const offending = sourceFiles().filter((file) => wrapped.test(readFileSync(file, "utf8")));
    expect(offending).toEqual([]);
  });
});

/** An act declared once for this suite, so the doors have something declared to write. */
const PROBE = declareActs("platform", {
  written: act("platform.probe.written", { adminUserId: "id", role: "role", confirmed: "flag" }),
  noted: act("platform.probe.noted", { confirmed: "flag" }),
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

    // An unscoped transaction, as an identity-set write would be: the scope resolves to
    // NULL, which the policy refuses before the column can, so the row is impossible
    // rather than merely unwritten.
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

  it("rejects an id-kind field holding an email, an act nobody declared, and an id not the minter's", async () => {
    const { door, workspaceId, adminUserId } = await provisioned();
    const write = (event: Parameters<typeof record>[2]) =>
      withScope(bootstrap, door, workspaceId, (tx) => record(bootstrap, tx, event));

    await expect(
      write({
        id: ulid(),
        act: PROBE.written,
        subjectId: adminUserId,
        detail: { adminUserId: "priya@example.invalid", role: "Admin", confirmed: true },
      }),
    ).rejects.toThrow(/adminUserId is not a id/);
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
    ).rejects.toThrow(/refused at the boundary/);
  });
});

describe("the second door — recordFor, the platform naming the actor", () => {
  it("lands a row booked to the actor named, not to the platform", async () => {
    const { door, workspaceId } = await provisioned();
    const id = ulid();
    // A person who holds no membership here and so no Principal — T-061's requester. The
    // kernel derivation for that case is T-061's; the door takes any actor id.
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

  it("is not reachable from a user principal, in the type and at runtime", async () => {
    const { door, workspaceId, adminUserId } = await provisioned();
    // The ids come through the boundary, so the brands are earned rather than asserted.
    const admin: UserPrincipal = {
      kind: "user",
      workspaceId: boundarySchemas.workspace.select.shape.id.parse(workspaceId),
      userId: boundarySchemas.user.select.shape.id.parse(adminUserId),
      role: "Admin",
      groups: [],
    };
    const id = ulid();

    await expect(
      withScope(bootstrap, door, workspaceId, (tx) =>
        // @ts-expect-error — a user principal is not a platform principal; no person's
        // session can book a row to somebody else.
        recordFor(admin, tx, {
          id,
          actor: `human:${ulid()}`,
          act: PROBE.noted,
          subjectId: workspaceId,
          detail: { confirmed: true },
        }),
      ),
    ).rejects.toThrow(/only the platform principal/);
    expect(await rowById(id)).toBeUndefined();
  });
});
