import { describe, expect, it } from "vitest";

import { withRepositoryLock } from "@better-answers/core/store/git";
import { conceptIriOf, ulid } from "@better-answers/schema";

import {
  nameOwner,
  ownerOf,
  writeConcept,
  type ConceptWritten,
  type OwnedConcept,
  type WriteConceptInput,
} from "../src/concepts/index.ts";
import { eraseFromTheIdentitySet } from "../src/erasure/index.ts";
import type { PlatformPrincipal, Result, UserPrincipal } from "../src/kernel/index.ts";
import { withMember } from "../src/store/postgres/index.ts";
import { bundleHistory, commitFacts, gatingRefUpdates } from "./bundle.ts";
import {
  backendPidOf,
  isBlockedOnALock,
  parkedOnTable,
  writeRevokedWhileParked,
} from "./revocation-race.ts";
import { connectedSourceHolding } from "./sourced-concept.ts";
import {
  holdingTable,
  isBlockedOnTable,
  lendingOnceSettled,
  seedingWith,
  statementsWaitingOnALock,
  until,
} from "./suite-postgres.ts";
import {
  doorsOf,
  EDITORS_COLLECTIONS,
  nameOwnerAs,
  suiteWithBundles,
  type Scenario,
} from "./workspace-with-bundle.ts";

const { db, arrange } = suiteWithBundles();

let written = 0;

const conceptAt = (path: string, overrides: Partial<WriteConceptInput> = {}): WriteConceptInput => {
  written += 1;
  return {
    mergeKey: `policy:owned-${written}`,
    path,
    kind: "Policy",
    title: `Owned ${written}`,
    frontmatter: { title: `Owned ${written}`, type: "Policy" },
    body: "Expenses are claimed within thirty days.",
    message: "Record the expenses policy",
    author: { name: "Ada Editor", email: "ada@acme.invalid" },
    expects: { head: null },
    status: "stable",
    sensitivity: "Internal",
    ...overrides,
  };
};

const writeAs = (
  scenario: Scenario,
  principal: UserPrincipal,
  input: WriteConceptInput,
): Promise<Result<ConceptWritten, unknown>> => writeConcept(principal, doorsOf(scenario), input);

const landedAs = async (
  scenario: Scenario,
  principal: UserPrincipal,
  input: WriteConceptInput,
): Promise<ConceptWritten> => {
  const landed = await writeAs(scenario, principal, input);
  if (!landed.ok) throw new Error(`the write was refused: ${String(landed.error)}`);
  return landed.value;
};

const rewriteOf = (input: WriteConceptInput, landed: ConceptWritten): WriteConceptInput => ({
  ...input,
  iri: landed.iri,
  body: `${input.body} Receipts are kept for six years.`,
  expects: { head: landed.sha },
});

const ownerRead = async (scenario: Scenario, concept: OwnedConcept) => {
  const read = await withMember(scenario.admin, scenario.postgres, (fresh, tx) =>
    ownerOf(fresh, tx, concept),
  );
  if (!read.ok) throw new Error(`the owner read was refused: ${read.error}`);
  return read.value;
};

const outsider = async (): Promise<string> =>
  (await seedingWith(db().pool, (seed) => seed.user())).id;

const ownedByTheViewer = async () => {
  const scenario = await arrange();
  const input = conceptAt("knowledge/policy/expenses.md");
  const landed = await landedAs(scenario, scenario.admin, input);
  await nameOwnerAs(scenario.admin, scenario.postgres, {
    iri: landed.iri,
    personId: scenario.viewer.userId,
  });
  return { scenario, input, landed };
};

const landedByTheGuidanceOwner = async () => {
  const scenario = await arrange();
  await nameOwnerAs(scenario.admin, scenario.postgres, {
    collection: "guidance",
    personId: scenario.viewer.userId,
  });
  const input = conceptAt("knowledge/guidance/expenses.md");
  return { scenario, input, landed: await landedAs(scenario, scenario.viewer, input) };
};

describe("a direct write, decided by the concept's owner", () => {
  it("commits an owning Editor's direct write with them as author", async () => {
    const scenario = await arrange();
    const input = conceptAt("knowledge/policy/expenses.md");

    const landed = await landedAs(scenario, scenario.editor, input);

    const facts = await commitFacts(scenario.git, scenario.workspaceId, landed.sha);
    expect({ author: facts.author, actor: facts.trailers["Actor"] }).toEqual({
      author: "Ada Editor <ada@acme.invalid>",
      actor: `human:${scenario.editor.userId}`,
    });
  });

  it("refuses an Editor owning nothing a direct write", async () => {
    const scenario = await arrange();
    await nameOwnerAs(scenario.admin, scenario.postgres, { collection: "policy", personId: null });

    const refused = await writeAs(
      scenario,
      scenario.editor,
      conceptAt("knowledge/policy/expenses.md"),
    );

    expect(refused).toEqual({ ok: false, error: "owner-forbids" });
    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toEqual([]);
  });

  it("commits a Viewer's direct write on a concept they own", async () => {
    const { scenario, input, landed } = await ownedByTheViewer();

    const rewritten = await landedAs(scenario, scenario.viewer, rewriteOf(input, landed));

    const facts = await commitFacts(scenario.git, scenario.workspaceId, rewritten.sha);
    expect(facts.trailers["Actor"]).toBe(`human:${scenario.viewer.userId}`);
  });

  it("prefers the concept's own owner to its collection's", async () => {
    const { scenario, input, landed } = await ownedByTheViewer();

    const owner = await ownerRead(scenario, { iri: landed.iri, path: input.path });
    const byTheCollectionsOwner = await writeAs(
      scenario,
      scenario.editor,
      rewriteOf(input, landed),
    );

    expect(owner).toBe(scenario.viewer.userId);
    expect(byTheCollectionsOwner).toEqual({ ok: false, error: "owner-forbids" });
  });

  it("takes a new concept's owner from its collection", async () => {
    const { scenario, input, landed } = await landedByTheGuidanceOwner();

    expect(await ownerRead(scenario, { iri: landed.iri, path: input.path })).toBe(
      scenario.viewer.userId,
    );
  });

  it("leaves a concept nobody owns to Admins", async () => {
    const scenario = await arrange();
    const input = conceptAt("knowledge/unowned/expenses.md");

    const byAnEditor = await writeAs(scenario, scenario.editor, input);
    const byAnAdmin = await writeAs(scenario, scenario.admin, input);

    expect(byAnEditor).toEqual({ ok: false, error: "owner-forbids" });
    expect(byAnAdmin).toMatchObject({ ok: true });
  });

  it("owns nothing once the owner leaves the workspace", async () => {
    const scenario = await arrange();
    const input = conceptAt("knowledge/policy/expenses.md");
    const landed = await landedAs(scenario, scenario.editor, input);

    await db().pool.query("DELETE FROM member WHERE workspace_id = $1 AND user_id = $2", [
      scenario.workspaceId,
      scenario.editor.userId,
    ]);

    expect(await ownerRead(scenario, { iri: landed.iri, path: input.path })).toBeUndefined();
  });
});

describe("ownership judged at the time of the act", () => {
  it("refuses an owner cleared before the write lands", async () => {
    const scenario = await arrange();
    let pending: Promise<Result<ConceptWritten, unknown>> | undefined;

    await withRepositoryLock(scenario.admin, scenario.git, async () => {
      pending = writeAs(scenario, scenario.editor, conceptAt("knowledge/policy/expenses.md"));
      await nameOwnerAs(scenario.admin, scenario.postgres, {
        collection: "policy",
        personId: null,
      });
    });

    expect(await pending).toEqual({ ok: false, error: "owner-forbids" });
    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toEqual([]);
  });

  it("refuses an owner cleared between the read and the commit", async () => {
    const scenario = await arrange();
    const cited = await connectedSourceHolding(db(), scenario.workspaceId);

    const landed = await writeRevokedWhileParked(
      db().pool,
      scenario.postgres,
      {
        write: (postgres) =>
          writeConcept(
            scenario.editor,
            { ...doorsOf(scenario), postgres },
            conceptAt("knowledge/policy/expenses.md", {
              evidence: [
                { sourceDocumentId: cited.documentId, locator: "p.1", resource: "Handbook" },
              ],
            }),
          ),
        revoke: (client) =>
          client.query(
            "DELETE FROM concept_owner WHERE workspace_id = $1 AND collection = 'policy'",
            [scenario.workspaceId],
          ),
      },
      parkedOnTable(db().pool, "source_document"),
    );

    expect(landed).toEqual({ ok: false, error: "owner-forbids" });
    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toEqual([]);
  });

  it("refuses an owner writing another collection's concept by path", async () => {
    const { scenario, input, landed } = await landedByTheGuidanceOwner();

    const refused = await writeAs(scenario, scenario.editor, {
      ...rewriteOf(input, landed),
      path: "knowledge/policy/expenses.md",
    });

    expect(refused).toEqual({ ok: false, error: "owner-forbids" });
  });

  it("refuses a non-owner before saying a path is taken", async () => {
    const scenario = await arrange();
    const taken = conceptAt("knowledge/policy/expenses.md");
    await landedAs(scenario, scenario.editor, taken);

    const refused = await writeAs(
      scenario,
      scenario.unowned,
      conceptAt(taken.path, {
        expects: { head: (await bundleHistory(scenario.git, scenario.workspaceId))[0] ?? null },
      }),
    );

    expect(refused).toEqual({ ok: false, error: "owner-forbids" });
  });

  it("holds a clear behind the write that read its owner", async () => {
    const scenario = await arrange();
    const gate = await gatingRefUpdates(scenario.git, scenario.workspaceId);
    await gate.park();
    const clearer = await db().pool.connect();
    try {
      const pending = writeAs(scenario, scenario.editor, conceptAt("knowledge/policy/expenses.md"));
      await until(gate.parked);

      const pid = await backendPidOf(clearer);
      const clearing = clearer.query(
        "DELETE FROM concept_owner WHERE workspace_id = $1 AND collection = 'policy'",
        [scenario.workspaceId],
      );
      await until(() => isBlockedOnALock(db().pool, pid));
      await gate.unpark();

      expect(await pending).toMatchObject({ ok: true });
      expect((await clearing).rowCount).toBe(1);
    } finally {
      clearer.release();
    }
  });
});

describe("an override named while a write is in flight", () => {
  it("holds a new override behind a write already in flight", async () => {
    const scenario = await arrange();
    const input = conceptAt("knowledge/policy/expenses.md");
    const landed = await landedAs(scenario, scenario.editor, input);
    const gate = await gatingRefUpdates(scenario.git, scenario.workspaceId);
    await gate.park();

    const pending = writeAs(scenario, scenario.editor, rewriteOf(input, landed));
    await until(gate.parked);
    const naming = nameOwnerAs(scenario.admin, scenario.postgres, {
      iri: landed.iri,
      personId: scenario.viewer.userId,
    });
    await until(async () =>
      (await statementsWaitingOnALock(db().pool)).some((query) =>
        query.includes("FROM concept_identity"),
      ),
    );
    await gate.unpark();

    expect(await pending).toMatchObject({ ok: true });
    await naming;
    expect(await ownerRead(scenario, { iri: landed.iri, path: input.path })).toBe(
      scenario.viewer.userId,
    );
  });
});

describe("an owner erased while their write is in flight", () => {
  it("finishes both the erasure and the write, deadlocking neither", async () => {
    const scenario = await arrange();
    const input = conceptAt("knowledge/policy/expenses.md");
    const landed = await landedAs(scenario, scenario.editor, input);
    const platform: PlatformPrincipal = { kind: "platform", actorId: "process:better-answers-ops" };
    const { pseudonym } = await seedingWith(db().pool, (seed) =>
      seed.erasureRequest({ workspaceId: scenario.workspaceId }),
    );
    let erasing: Promise<unknown> = Promise.resolve();
    const postgres = {
      ...scenario.postgres,
      pool: lendingOnceSettled(scenario.postgres.pool, () => erasing),
    };
    let pending: Promise<Result<ConceptWritten, unknown>> | undefined;
    let erased: ReturnType<typeof eraseFromTheIdentitySet> | undefined;

    await holdingTable(db().pool, "concept_identity", async () => {
      pending = writeConcept(
        scenario.editor,
        { ...doorsOf(scenario), postgres },
        rewriteOf(input, landed),
      );
      await until(() => isBlockedOnTable(db().pool, "concept_identity"));
      erased = eraseFromTheIdentitySet(platform, scenario.postgres, {
        workspaceId: scenario.workspaceId,
        personId: scenario.editor.userId,
        emails: [],
        needles: { addresses: [], people: [scenario.editor.userId] },
        pseudonym,
      });
      erasing = erased;
      await until(async () =>
        (await statementsWaitingOnALock(db().pool)).some((query) =>
          query.includes("DELETE FROM member"),
        ),
      );
    });
    const [write, erasure] = await Promise.allSettled([pending, erased]);

    expect(erasure).toMatchObject({
      status: "fulfilled",
      value: { membersEnded: 1, ownersDeleted: EDITORS_COLLECTIONS.length },
    });
    expect(write).toEqual({ status: "fulfilled", value: { ok: false, error: "not-a-member" } });
    const left = await db().pool.query(
      "SELECT 1 FROM concept_owner WHERE workspace_id = $1 AND person_id = $2",
      [scenario.workspaceId, scenario.editor.userId],
    );
    expect(left.rowCount).toBe(0);
  });
});

describe("naming an owner", () => {
  it("names an owner as Admin alone, with its audit event", async () => {
    const scenario = await arrange();
    const asked = { collection: "guidance", personId: scenario.viewer.userId } as const;

    const byAnEditor = await withMember(scenario.editor, scenario.postgres, (fresh, tx) =>
      nameOwner(fresh, tx, asked),
    );
    const byAnAdmin = await withMember(scenario.admin, scenario.postgres, (fresh, tx) =>
      nameOwner(fresh, tx, asked),
    );

    expect(byAnEditor).toEqual({ ok: true, value: { ok: false, error: "role-forbids" } });
    expect(byAnAdmin).toMatchObject({ ok: true, value: { ok: true } });
    const events = await db().pool.query(
      `SELECT actor, subject_id, detail FROM audit_event
        WHERE workspace_id = $1 AND action = 'knowledge.owner.named' AND subject_id = 'guidance'`,
      [scenario.workspaceId],
    );
    expect(events.rows).toEqual([
      {
        actor: `human:${scenario.admin.userId}`,
        subject_id: "guidance",
        detail: { collection: "guidance", personId: scenario.viewer.userId },
      },
    ]);
  });

  it("refuses to name a person outside the workspace", async () => {
    const scenario = await arrange();
    const stranger = await outsider();

    const named = await withMember(scenario.admin, scenario.postgres, (fresh, tx) =>
      nameOwner(fresh, tx, { collection: "guidance", personId: stranger }),
    );

    expect(named).toEqual({ ok: true, value: { ok: false, error: "no-such-member" } });
  });

  it("refuses a subject naming no collection as malformed", async () => {
    const scenario = await arrange();

    const named = await withMember(scenario.admin, scenario.postgres, (fresh, tx) =>
      // @ts-expect-error — an untyped transport could send a null subject.
      nameOwner(fresh, tx, { collection: null, personId: null }),
    );

    expect(named).toEqual({ ok: true, value: { ok: false, error: "malformed" } });
  });

  it("refuses an owner for a concept that does not stand", async () => {
    const scenario = await arrange();

    const named = await withMember(scenario.admin, scenario.postgres, (fresh, tx) =>
      nameOwner(fresh, tx, {
        iri: conceptIriOf(ulid()),
        personId: scenario.viewer.userId,
      }),
    );

    expect(named).toEqual({ ok: true, value: { ok: false, error: "no-such-concept" } });
  });

  it("replaces a collection's owner, then clears it", async () => {
    const scenario = await arrange();
    const input = conceptAt("knowledge/policy/expenses.md");
    const concept = { iri: null, path: input.path };

    await nameOwnerAs(scenario.admin, scenario.postgres, {
      collection: "policy",
      personId: scenario.viewer.userId,
    });
    const replaced = await ownerRead(scenario, concept);
    await nameOwnerAs(scenario.admin, scenario.postgres, { collection: "policy", personId: null });

    expect(replaced).toBe(scenario.viewer.userId);
    expect(await ownerRead(scenario, concept)).toBeUndefined();
    const named = await db().pool.query(
      `SELECT detail FROM audit_event
        WHERE workspace_id = $1 AND action = 'knowledge.owner.named' ORDER BY id`,
      [scenario.workspaceId],
    );
    expect(named.rows).toEqual([
      { detail: { collection: "policy", personId: scenario.viewer.userId } },
      { detail: { collection: "policy" } },
    ]);
  });
});
