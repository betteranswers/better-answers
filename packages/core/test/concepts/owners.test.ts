import { assert, describe, expect, it } from "vitest";

import { eraseFromTheIdentitySet } from "@better-answers/core/erasure";
import type { PlatformPrincipal, Result, UserPrincipal } from "@better-answers/core/kernel";
import { withRepositoryLock } from "@better-answers/core/store/git";
import { withMember } from "@better-answers/core/store/postgres";
import { conceptIriOf, passageLocatorOf, ulid, type ConceptIri } from "@better-answers/schema";

import {
  collectionsAndOwners,
  nameOwner,
  nameOwnerOfEach,
  nameOwnerOfEachInput,
  ownedBy,
  ownerOf,
  writeConcept,
  type ConceptWritten,
  type NameOwnerOfEachInput,
  type OwnedConcept,
  type WriteConceptInput,
} from "../../src/concepts/index.ts";
import { bundleHistory, commitFacts, gatingRefUpdates } from "../fixtures/bundle.ts";
import { shelve, shelveOne, type Shelved } from "../fixtures/concept-shelf.ts";
import { connectedSourceHolding } from "../fixtures/sourced-concept.ts";
import {
  doorsOf,
  EDITORS_COLLECTIONS,
  nameOwnerAs,
  suiteWithBundles,
  type Scenario,
} from "../fixtures/workspace-with-bundle.ts";
import {
  answered,
  holdingTable,
  isBlockedOnTable,
  poolWaitingFor,
  seedingWith,
  statementsWaitingOnALock,
  until,
} from "../support/suite-postgres.ts";
import {
  backendPidOf,
  isBlockedOnALock,
  parkedOnTable,
  writeRevokedWhileParked,
} from "./revocation-race.ts";

const { db, arrange } = suiteWithBundles();

let written = 0;

const conceptAt = (path: string, overrides: Partial<WriteConceptInput> = {}): WriteConceptInput => {
  written += 1;
  return {
    mergeKey: `policy:owned-${written}`,
    path,
    conceptType: "Policy",
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

describe("who may write a concept directly", () => {
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

  it("refuses a direct write by an Editor who owns nothing", async () => {
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

  it("uses the concept's own owner over its collection's owner", async () => {
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

  it("lets only Admins write a concept nobody owns", async () => {
    const scenario = await arrange();
    const input = conceptAt("knowledge/unowned/expenses.md");

    const byAnEditor = await writeAs(scenario, scenario.editor, input);
    const byAnAdmin = await writeAs(scenario, scenario.admin, input);

    expect(byAnEditor).toEqual({ ok: false, error: "owner-forbids" });
    expect(byAnAdmin).toMatchObject({ ok: true });
  });

  it("drops ownership once the owner leaves the workspace", async () => {
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

describe("ownership checked at the time of the write", () => {
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
              frontmatter: {
                title: "Expenses",
                type: "Policy",
                sources: [
                  { resource: "Handbook", locator: passageLocatorOf(cited.documentId, 0, 1) },
                ],
              },
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

  it("refuses a non-owner before reporting that the path is taken", async () => {
    const scenario = await arrange();
    const taken = conceptAt("knowledge/policy/expenses.md");
    await landedAs(scenario, scenario.editor, taken);
    const [head] = await bundleHistory(scenario.git, scenario.workspaceId);
    assert(head !== undefined, "the owner's write did not commit");

    const refused = await writeAs(
      scenario,
      scenario.unowned,
      conceptAt(taken.path, { expects: { head } }),
    );

    expect(refused).toEqual({ ok: false, error: "owner-forbids" });
  });

  it("makes clearing an owner wait for the write reading it", async () => {
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

describe("an override named while a write is running", () => {
  it("makes a new override wait for a running write", async () => {
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

const ERASING: PlatformPrincipal = { kind: "platform", actorId: "process:better-answers-ops" };

const erasingTheEditor = async (scenario: Scenario) => {
  const { pseudonym } = await seedingWith(db().pool, (seed) =>
    seed.erasureRequest({ workspaceId: scenario.workspaceId }),
  );
  return () =>
    eraseFromTheIdentitySet(ERASING, scenario.postgres, {
      workspaceId: scenario.workspaceId,
      personId: scenario.editor.userId,
      emails: [],
      needles: { addresses: [], people: [scenario.editor.userId] },
      pseudonym,
    });
};

const erasureWaitsOnTheMember = async () =>
  (await statementsWaitingOnALock(db().pool)).some((query) => query.includes("FROM member"));

const ownersLeft = async (scenario: Scenario) =>
  (
    await db().pool.query(
      "SELECT 1 FROM concept_owner WHERE workspace_id = $1 AND person_id = $2",
      [scenario.workspaceId, scenario.editor.userId],
    )
  ).rowCount;

describe("an owner erased while their write is running", () => {
  it("finishes both the erasure and the write without deadlock", async () => {
    const scenario = await arrange();
    const input = conceptAt("knowledge/policy/expenses.md");
    const landed = await landedAs(scenario, scenario.editor, input);
    const erase = await erasingTheEditor(scenario);
    let erasing: Promise<unknown> = Promise.resolve();
    const postgres = {
      ...scenario.postgres,
      pool: poolWaitingFor(scenario.postgres.pool, () => erasing),
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
      erased = erase();
      erasing = erased;
      await until(erasureWaitsOnTheMember);
    });
    const [write, erasure] = await Promise.allSettled([pending, erased]);

    expect(erasure).toMatchObject({
      status: "fulfilled",
      value: { membersEnded: 1, ownersDeleted: EDITORS_COLLECTIONS.length },
    });
    expect(write).toEqual({ status: "fulfilled", value: { ok: false, error: "not-a-member" } });
    expect(await ownersLeft(scenario)).toBe(0);
  });

  it("counts an owner named while the erasure waits", async () => {
    const scenario = await arrange();
    const erase = await erasingTheEditor(scenario);
    const holder = await db().pool.connect();
    let erased: ReturnType<typeof eraseFromTheIdentitySet> | undefined;
    try {
      await holder.query("BEGIN");
      await holder.query(
        "SELECT 1 FROM member WHERE workspace_id = $1 AND user_id = $2 FOR KEY SHARE",
        [scenario.workspaceId, scenario.editor.userId],
      );
      erased = erase();
      await until(erasureWaitsOnTheMember);
      await nameOwnerAs(scenario.admin, scenario.postgres, {
        collection: "guidance",
        personId: scenario.editor.userId,
      });
    } finally {
      await holder.query("COMMIT");
      holder.release();
    }

    expect(await erased).toMatchObject({
      membersEnded: 1,
      ownersDeleted: EDITORS_COLLECTIONS.length + 1,
    });
    expect(await ownersLeft(scenario)).toBe(0);
  });
});

describe("naming an owner", () => {
  it("lets only an Admin name an owner, and audits it", async () => {
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

  it("refuses a subject that names no collection as malformed", async () => {
    const scenario = await arrange();

    const named = await withMember(scenario.admin, scenario.postgres, (fresh, tx) =>
      // @ts-expect-error — an untyped transport could send a null subject.
      nameOwner(fresh, tx, { collection: null, personId: null }),
    );

    expect(named).toEqual({ ok: true, value: { ok: false, error: "malformed" } });
  });

  it("refuses an owner for a concept that does not exist", async () => {
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

const OWNER_EVENTS = `SELECT actor, subject_id, detail, batch_id FROM audit_event
    WHERE workspace_id = $1 AND action = 'knowledge.owner.named' ORDER BY subject_id`;

const overridesOf = async (scenario: Scenario): Promise<readonly string[]> =>
  (
    await db().pool.query<{ iri: string; person_id: string }>(
      `SELECT iri, person_id FROM concept_owner
        WHERE workspace_id = $1 AND iri IS NOT NULL ORDER BY iri`,
      [scenario.workspaceId],
    )
  ).rows.map(({ iri, person_id }) => `${iri} ${person_id}`);

const namingEach = (scenario: Scenario, by: UserPrincipal, input: NameOwnerOfEachInput) =>
  withMember(by, scenario.postgres, (fresh, tx) => nameOwnerOfEach(fresh, tx, input));

const nothingNamed = async (scenario: Scenario) => ({
  overrides: await overridesOf(scenario),
  events: (await db().pool.query(OWNER_EVENTS, [scenario.workspaceId])).rowCount,
});

const shelvedPolicies = (scenario: Scenario, count: number): Promise<readonly ConceptIri[]> =>
  shelve(
    db().pool,
    scenario.workspaceId,
    Array.from({ length: count }, (_unused, at) => ({ path: `knowledge/policy/rule-${at}.md` })),
  );

describe("naming one owner for many concepts", () => {
  it("names one owner for many concepts under one batch id", async () => {
    const scenario = await arrange();
    const iris = await shelvedPolicies(scenario, 3);

    const named = await namingEach(scenario, scenario.admin, {
      iris: [...iris],
      personId: scenario.viewer.userId,
    });

    const { batchId, ...counted } = answered(answered(named));
    expect(counted).toEqual({ named: 3 });
    expect(batchId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/u);
    const events = await db().pool.query(OWNER_EVENTS, [scenario.workspaceId]);
    expect(events.rows).toEqual(
      iris.toSorted().map((iri) => ({
        actor: `human:${scenario.admin.userId}`,
        subject_id: iri,
        detail: { iri, personId: scenario.viewer.userId },
        batch_id: batchId,
      })),
    );
    expect(await overridesOf(scenario)).toEqual(
      iris.toSorted().map((iri) => `${iri} ${scenario.viewer.userId}`),
    );
  });

  it("lets the new override take precedence over the collection's owner", async () => {
    const scenario = await arrange();
    const iri = await shelveOne(db().pool, scenario.workspaceId, {
      path: "knowledge/policy/rule-0.md",
    });

    await namingEach(scenario, scenario.admin, { iris: [iri], personId: scenario.viewer.userId });

    expect(await ownerRead(scenario, { iri, path: "knowledge/policy/rule-0.md" })).toBe(
      scenario.viewer.userId,
    );
    expect(await ownerRead(scenario, { iri: null, path: "knowledge/policy/other.md" })).toBe(
      scenario.editor.userId,
    );
  });

  it("writes the event for one concept without a batch id", async () => {
    const scenario = await arrange();
    const iri = await shelveOne(db().pool, scenario.workspaceId, {
      path: "knowledge/policy/rule-0.md",
    });

    const named = await namingEach(scenario, scenario.admin, {
      iris: [iri],
      personId: scenario.viewer.userId,
    });

    expect(named).toEqual({
      ok: true,
      value: { ok: true, value: { named: 1, batchId: undefined } },
    });
    const events = await db().pool.query(OWNER_EVENTS, [scenario.workspaceId]);
    expect(events.rows).toMatchObject([{ subject_id: iri, batch_id: null }]);
  });

  it("collapses a repeated concept into one override and one event", async () => {
    const scenario = await arrange();
    const iris = await shelvedPolicies(scenario, 2);

    const named = await namingEach(scenario, scenario.admin, {
      iris: [...iris, ...iris.toReversed()],
      personId: scenario.viewer.userId,
    });

    expect(named).toMatchObject({ ok: true, value: { ok: true, value: { named: 2 } } });
    expect((await db().pool.query(OWNER_EVENTS, [scenario.workspaceId])).rowCount).toBe(2);
    expect(await overridesOf(scenario)).toHaveLength(2);
  });

  it("replaces an override already named, keeping one row", async () => {
    const scenario = await arrange();
    const kept = await shelveOne(db().pool, scenario.workspaceId, {
      path: "knowledge/policy/kept.md",
    });
    const replaced = await shelveOne(db().pool, scenario.workspaceId, {
      path: "knowledge/policy/replaced.md",
    });
    for (const iri of [kept, replaced]) {
      await nameOwnerAs(scenario.admin, scenario.postgres, {
        iri,
        personId: scenario.editor.userId,
      });
    }

    await namingEach(scenario, scenario.admin, {
      iris: [replaced],
      personId: scenario.viewer.userId,
    });

    expect(await overridesOf(scenario)).toEqual(
      [`${kept} ${scenario.editor.userId}`, `${replaced} ${scenario.viewer.userId}`].toSorted(),
    );
  });

  it("hands concepts back to their collection's owner when unnamed", async () => {
    const scenario = await arrange();
    const shelved = (path: string) => shelveOne(db().pool, scenario.workspaceId, { path });
    const leave = await shelved("knowledge/policy/leave.md");
    const expenses = await shelved("knowledge/policy/expenses.md");
    const kept = await shelved("knowledge/policy/kept.md");
    await namingEach(scenario, scenario.admin, {
      iris: [leave, expenses, kept],
      personId: scenario.viewer.userId,
    });

    const named = await namingEach(scenario, scenario.admin, {
      iris: [leave, expenses],
      personId: null,
    });

    expect(named).toMatchObject({ ok: true, value: { ok: true, value: { named: 2 } } });
    expect(await overridesOf(scenario)).toEqual([`${kept} ${scenario.viewer.userId}`]);
    expect(await ownerRead(scenario, { iri: leave, path: "knowledge/policy/leave.md" })).toBe(
      scenario.editor.userId,
    );
    const events = await db().pool.query(OWNER_EVENTS, [scenario.workspaceId]);
    expect(events.rows.filter(({ detail }) => !("personId" in detail))).toHaveLength(2);
  });

  it("leaves a concept unowned when its collection has no owner", async () => {
    const scenario = await arrange();
    const drills = "knowledge/safety/drills.md";
    const iri = await shelveOne(db().pool, scenario.workspaceId, { path: drills });
    await namingEach(scenario, scenario.admin, { iris: [iri], personId: scenario.viewer.userId });

    const named = await namingEach(scenario, scenario.admin, { iris: [iri], personId: null });

    expect(named).toMatchObject({ ok: true, value: { ok: true, value: { named: 1 } } });
    expect(await overridesOf(scenario)).toEqual([]);
    expect(await ownerRead(scenario, { iri, path: drills })).toBeUndefined();
  });

  it("refuses the batch when one concept is unreadable", async () => {
    const scenario = await arrange();
    const group = await seedingWith(db().pool, (seed) =>
      seed.group({ workspaceId: scenario.workspaceId, name: "HR team" }),
    );
    const shelved = (concept: Shelved) => shelveOne(db().pool, scenario.workspaceId, concept);
    const open = await shelved({ path: "knowledge/policy/open.md" });
    const withheld = await shelved({
      path: "knowledge/people/grievances.md",
      audienceGroups: [group.id],
    });
    const unpublished = await shelved({ path: "knowledge/policy/draft.md", draft: true });
    const batchWith = (stray: ConceptIri) =>
      namingEach(scenario, scenario.admin, {
        iris: [open, stray],
        personId: scenario.viewer.userId,
      });

    const answers = [
      await batchWith(withheld),
      await batchWith(unpublished),
      await batchWith(conceptIriOf(ulid())),
    ];

    const refused = { ok: true, value: { ok: false, error: "no-such-concept" } };
    expect(answers).toEqual([refused, refused, refused]);
    expect(await nothingNamed(scenario)).toEqual({ overrides: [], events: 0 });
  });

  it("names an owner for a Restricted concept as an Admin", async () => {
    const scenario = await arrange();
    const iri = await shelveOne(db().pool, scenario.workspaceId, {
      path: "knowledge/held/salaries.md",
      sensitivity: "Restricted",
    });

    const named = await namingEach(scenario, scenario.admin, {
      iris: [iri],
      personId: scenario.viewer.userId,
    });

    expect(named).toMatchObject({ ok: true, value: { ok: true } });
  });

  it("refuses anyone but an Admin and writes nothing", async () => {
    const scenario = await arrange();
    const iris = await shelvedPolicies(scenario, 2);
    const asked = { iris: [...iris], personId: scenario.viewer.userId };

    const byAnEditor = await namingEach(scenario, scenario.editor, asked);
    const byAViewer = await namingEach(scenario, scenario.viewer, asked);

    const refused = { ok: true, value: { ok: false, error: "role-forbids" } };
    expect([byAnEditor, byAViewer]).toEqual([refused, refused]);
    expect(await nothingNamed(scenario)).toEqual({ overrides: [], events: 0 });
  });

  it("refuses a person outside the workspace and writes nothing", async () => {
    const scenario = await arrange();
    const iris = await shelvedPolicies(scenario, 2);

    const named = await namingEach(scenario, scenario.admin, {
      iris: [...iris],
      personId: await outsider(),
    });

    expect(named).toEqual({ ok: true, value: { ok: false, error: "no-such-member" } });
    expect(await overridesOf(scenario)).toEqual([]);
  });

  it.each<[string, () => readonly unknown[]]>([
    ["an empty batch", () => []],
    ["over two hundred concepts", () => Array.from({ length: 201 }, () => conceptIriOf(ulid()))],
    ["a name that is no concept", () => ["policy/rule-0"]],
  ])("refuses %s as malformed", async (_name, iris) => {
    const scenario = await arrange();

    const named = await namingEach(scenario, scenario.admin, {
      // @ts-expect-error an untyped transport could send anything.
      iris: iris(),
      personId: scenario.viewer.userId,
    });

    expect(named).toEqual({ ok: true, value: { ok: false, error: "malformed" } });
  });

  it("accepts up to two hundred concepts in the input", () => {
    const iris = Array.from({ length: 200 }, () => conceptIriOf(ulid()));
    const personId = ulid();

    const atTheLimit = nameOwnerOfEachInput.safeParse({ iris, personId });
    const pastIt = nameOwnerOfEachInput.safeParse({
      iris: [...iris, conceptIriOf(ulid())],
      personId,
    });

    expect([atTheLimit.success, pastIt.success]).toEqual([true, false]);
  });

  it("waits for a write that holds one of its concepts", async () => {
    const scenario = await arrange();
    const iris = await shelvedPolicies(scenario, 2);
    const writer = await db().pool.connect();
    let naming: ReturnType<typeof namingEach> | undefined;
    try {
      await writer.query("BEGIN");
      await writer.query(
        "SELECT 1 FROM concept_identity WHERE workspace_id = $1 AND iri = $2 FOR SHARE",
        [scenario.workspaceId, iris[1]],
      );
      naming = namingEach(scenario, scenario.admin, {
        iris: [...iris],
        personId: scenario.viewer.userId,
      });
      await until(async () =>
        (await statementsWaitingOnALock(db().pool)).some((query) =>
          query.includes("FROM concept_identity"),
        ),
      );
      expect(await overridesOf(scenario)).toEqual([]);
    } finally {
      await writer.query("COMMIT");
      writer.release();
    }

    expect(await naming).toMatchObject({ ok: true, value: { ok: true } });
    expect(await overridesOf(scenario)).toHaveLength(2);
  });
});

const nameOf = async (personId: string): Promise<string> => {
  const found = await db().pool.query<{ name: string }>('SELECT name FROM "user" WHERE id = $1', [
    personId,
  ]);
  const name = found.rows[0]?.name;
  if (name === undefined) throw new Error(`${personId} has no person row`);
  return name;
};

const NOW = new Date("2026-11-05T10:00:00Z");

const collectionsReadBy = (scenario: Scenario, reader: UserPrincipal) =>
  withMember(reader, scenario.postgres, (fresh, tx) => collectionsAndOwners(fresh, tx, NOW));

const ownedRead = (scenario: Scenario, reader: UserPrincipal) =>
  withMember(reader, scenario.postgres, (fresh, tx) => ownedBy(fresh, tx));

describe("reads that show a member what they own", () => {
  it("returns the member's owned collections and concept count", async () => {
    const { scenario } = await ownedByTheViewer();
    await nameOwnerAs(scenario.admin, scenario.postgres, {
      collection: "guidance",
      personId: scenario.viewer.userId,
    });

    const viewers = await ownedRead(scenario, scenario.viewer);
    const unowned = await ownedRead(scenario, scenario.unowned);

    expect(viewers).toEqual({
      ok: true,
      value: { ok: true, value: { collections: ["guidance"], concepts: 1 } },
    });
    expect(unowned).toEqual({
      ok: true,
      value: { ok: true, value: { collections: [], concepts: 0 } },
    });
  });

  it("counts no owned concept that its owner cannot read", async () => {
    const { scenario, landed } = await ownedByTheViewer();
    const held = await landedAs(
      scenario,
      scenario.admin,
      conceptAt("knowledge/held/salaries.md", {
        sensitivity: "Restricted",
        expects: { head: landed.sha },
      }),
    );
    await nameOwnerAs(scenario.admin, scenario.postgres, {
      iri: held.iri,
      personId: scenario.viewer.userId,
    });

    const viewers = await ownedRead(scenario, scenario.viewer);

    expect(viewers).toEqual({
      ok: true,
      value: { ok: true, value: { collections: [], concepts: 1 } },
    });
  });

  it("lists only collections the reader may read", async () => {
    const scenario = await arrange();
    const policy = await landedAs(
      scenario,
      scenario.admin,
      conceptAt("knowledge/policy/expenses.md"),
    );
    await landedAs(
      scenario,
      scenario.admin,
      conceptAt("knowledge/held/salaries.md", {
        sensitivity: "Restricted",
        expects: { head: policy.sha },
      }),
    );
    await nameOwnerAs(scenario.admin, scenario.postgres, {
      iri: policy.iri,
      personId: scenario.viewer.userId,
    });
    const owner = { id: scenario.editor.userId, name: await nameOf(scenario.editor.userId) };

    const editors = await collectionsReadBy(scenario, scenario.editor);
    const admins = await collectionsReadBy(scenario, scenario.admin);

    expect(editors).toEqual({
      ok: true,
      value: {
        ok: true,
        value: {
          collections: [{ collection: "policy", owner, overrides: 1, concepts: 1, verified: 0 }],
        },
      },
    });
    expect(admins).toEqual({
      ok: true,
      value: {
        ok: true,
        value: {
          collections: [
            { collection: "held", owner, overrides: 0, concepts: 1, verified: 0 },
            { collection: "policy", owner, overrides: 1, concepts: 1, verified: 0 },
          ],
        },
      },
    });
  });

  it("counts each collection's concepts and the ones that stand verified", async () => {
    const scenario = await arrange();
    const checker = `human:${scenario.editor.userId}`;
    const shelved = await shelve(db().pool, scenario.workspaceId, [
      { path: "knowledge/policy/a.md", checks: [{ actor: checker, at: new Date("2026-10-01") }] },
      {
        path: "knowledge/policy/b.md",
        checks: [{ actor: "process:better-answers-test", at: new Date("2026-10-02") }],
      },
      { path: "knowledge/policy/c.md" },
      { path: "knowledge/safety/d.md" },
      { path: "knowledge/held/e.md", sensitivity: "Restricted" },
    ]);
    const edited = shelved[3];
    assert(edited !== undefined, "the safety concept was not shelved");
    await seedingWith(db().pool, (seed) =>
      seed.conceptVerification({
        workspaceId: scenario.workspaceId,
        iri: edited,
        actor: checker,
        verifiedAt: new Date("2026-10-03"),
      }),
    );

    const admins = answered(answered(await collectionsReadBy(scenario, scenario.admin)));
    const editors = answered(answered(await collectionsReadBy(scenario, scenario.editor)));

    expect(
      admins.collections.map(({ collection, concepts, verified }) => [
        collection,
        concepts,
        verified,
      ]),
    ).toEqual([
      ["held", 1, 0],
      ["policy", 3, 2],
      ["safety", 1, 0],
    ]);
    expect(editors.collections.map(({ collection }) => collection)).toEqual(["policy", "safety"]);
  });

  it("refuses the collections read to an Editor who owns nothing", async () => {
    const scenario = await arrange();
    await landedAs(scenario, scenario.admin, conceptAt("knowledge/policy/expenses.md"));

    const owning = await collectionsReadBy(scenario, scenario.editor);
    const owningNothing = await collectionsReadBy(scenario, scenario.unowned);

    expect(owning).toMatchObject({ ok: true, value: { ok: true } });
    expect(owningNothing).toEqual({ ok: true, value: { ok: false, error: "owner-forbids" } });
  });

  it("refuses the collections read to a concept's own owner", async () => {
    const { scenario } = await ownedByTheViewer();

    const conceptsOwner = await collectionsReadBy(scenario, scenario.viewer);

    expect(conceptsOwner).toEqual({ ok: true, value: { ok: false, error: "owner-forbids" } });
  });
});
