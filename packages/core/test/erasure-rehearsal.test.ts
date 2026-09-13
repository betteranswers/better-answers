import { describe, expect, it } from "vitest";

import {
  ERASURE,
  rehearseErasure,
  seedSyntheticSubject,
  type ErasureRehearsed,
  type SyntheticSubject,
} from "../src/erasure/index.ts";
import { bundleHistory, everyObjectOf, fileAtCommit } from "./bundle.ts";
import { ledgerRowsOf } from "./sourced-concept.ts";
import { objectStoreForSuite } from "./suite-objects.ts";
import { suiteWithBundles, type Scenario } from "./workspace-with-bundle.ts";

/**
 * **The erasure rehearsal's two phases** (ADR 0020, ADR 0022; the S0 spec, *The two ops
 * commands*): what the drill runs every third month to prove that erasure works, on a subject
 * staging is allowed to hold.
 *
 * Four sentences this suite is here to hold.
 *
 * **The seed is greppable.** A rehearsal is worth nothing unless somebody can look for the
 * subject afterwards and fail to find them, so the seed's whole answer is the set of *tokens* a
 * dump is grepped for — and every one of them has to be in the estate before the run, in the
 * rows and in the bundle, or the grep that finds nothing afterwards proves nothing.
 *
 * **The two phases are separable by a dump.** The drill takes a `pg_dump` *between* them, so
 * the second phase cannot be handed anything the first held: it finds the subject from the rows
 * alone, by the one address a workspace's synthetic subject always has. This suite proves it by
 * throwing the first phase's answer away and running the second from the workspace id.
 *
 * **The report is the real one.** "Equal in shape to a real erasure report" is only honest if it
 * *is* the report the routine wrote, so the wording below is written down as literals off ADR
 * 0020's amendments (`[TEST9]`) and never read back off `report.ts`.
 *
 * **And the ledger says a rehearsal happened without saying who it was about.** The act is the
 * platform's (`[AUDIT4]`), and its detail is ids and a count — never a token, because a detail
 * that carried one would be the one record of this person an erasure had just promised to
 * remove (`[AUDIT5]`).
 */

const { db, arrange } = suiteWithBundles();

/**
 * A real Garage, because the routine this runs writes its replay copy to the object store and
 * `[TEST3]` refuses a stand-in for a store as it refuses one for Postgres.
 */
const objects = objectStoreForSuite();

/** The instant every clock here hands back, so the report's dates are a literal (ADR 0040). */
const REHEARSED_AT = new Date("2026-06-01T12:00:00.000Z");

/** The four beyond-use dates from that anchor, worked out by hand as `erasure-routine.test.ts` does. */
const BEYOND_USE =
  "2026-06-03T12:00:00.000Z · 2026-07-01T12:00:00.000Z · " +
  "2026-07-27T12:00:00.000Z · 2026-12-01T12:00:00.000Z";

/** The one actor a rehearsal is booked to (`[AUDIT4]`, the platform's own id). */
const ERASURE_ACTOR = "process:better-answers-erasure";

/** The act the second phase writes, spelled out here rather than read off the module. */
const REHEARSED = "platform.erasure.rehearsed";

/** Where the seed's one concept file goes, written down rather than imported (`[TEST9]`). */
const CONCEPT_PATH = "knowledge/erasure-rehearsal.md";

/** The doors both phases take: the routine's four, with the clock pinned to a literal instant. */
const doorsFor = (scenario: Scenario, at: Date = REHEARSED_AT) => ({
  git: scenario.git,
  postgres: scenario.postgres,
  objects: objects().door,
  clock: { now: () => at },
});

/**
 * The address, the form a file names them by and the display name this workspace's synthetic
 * subject always has — spelled out here rather than imported, so a change to the derivation is
 * a failing test and not a test that agrees with itself (`[TEST9]`).
 */
const expectedTokensFor = (workspaceId: string): readonly string[] => {
  const email = `subject-${workspaceId.toLowerCase()}@erasure-rehearsal.example.test`;
  return [email, `human:${email}`, `Rehearsal subject ${workspaceId}`];
};

/** The seed as the command reaches it; a refusal is the arrangement failing, not the answer. */
const seeding = async (scenario: Scenario): Promise<SyntheticSubject> => {
  const seeded = await seedSyntheticSubject(ERASURE, doorsFor(scenario), {
    workspaceId: scenario.workspaceId,
  });
  if (!seeded.ok) throw new Error(`the seed refused: ${String(seeded.error)}`);
  return seeded.value;
};

/**
 * The second phase as the command reaches it, taking the workspace id and nothing else — which
 * is the point, so every case below is written through this rather than around it. A refusal is
 * the arrangement failing; the one case that expects a refusal calls `rehearseErasure` itself.
 */
const rehearsing = async (scenario: Scenario): Promise<ErasureRehearsed> => {
  const rehearsed = await rehearseErasure(ERASURE, doorsFor(scenario), {
    workspaceId: scenario.workspaceId,
  });
  if (!rehearsed.ok) throw new Error(`the rehearsal refused: ${String(rehearsed.error)}`);
  return rehearsed.value;
};

/** The user row as the superuser reads it, by person id — the identity set is not a tenant table. */
const personRow = async (personId: string) => {
  const read = await db().pool.query<{ name: string; email: string }>(
    'SELECT name, email FROM "user" WHERE id = $1',
    [personId],
  );
  return read.rows[0];
};

const membershipRows = async (workspaceId: string, personId: string) => {
  const read = await db().pool.query<{ role: string }>(
    "SELECT role FROM member WHERE workspace_id = $1 AND user_id = $2",
    [workspaceId, personId],
  );
  return read.rows;
};

describe("the seed", () => {
  it("writes one synthetic person, their membership and one concept file naming them, and answers with the tokens a dump is grepped for", async () => {
    const scenario = await arrange();
    const [email, named, name] = expectedTokensFor(scenario.workspaceId);

    const subject = await seeding(scenario);

    expect(subject.tokens).toEqual([email, named, name]);
    expect(await personRow(subject.personId)).toEqual({ name, email });
    expect(await membershipRows(scenario.workspaceId, subject.personId)).toEqual([
      { role: "Admin" },
    ]);
  });

  it("names the subject in the concept file's own text, in the one form the routine rewrites", async () => {
    const scenario = await arrange();
    const [, named] = expectedTokensFor(scenario.workspaceId);

    await seeding(scenario);

    const history = await bundleHistory(scenario.git, scenario.workspaceId);
    const sha = history.at(-1) ?? "";
    const file = await fileAtCommit(scenario.git, scenario.workspaceId, sha, CONCEPT_PATH);
    expect(file).toContain(named);
  });

  it("is the same subject the second time, because a drill phase re-run is not a second person", async () => {
    const scenario = await arrange();

    const first = await seeding(scenario);
    const second = await seeding(scenario);

    expect(second.personId).toBe(first.personId);
    expect(second.tokens).toEqual(first.tokens);
    expect(await membershipRows(scenario.workspaceId, first.personId)).toHaveLength(1);
  });
});

describe("the rehearsal", () => {
  it("finds the subject the seed left in the rows, so a dump may be taken between the two phases", async () => {
    const scenario = await arrange();
    // The first phase's answer is deliberately thrown away: everything the second phase needs
    // it reads back out of the rows, which is what survives a dump and a restore between them.
    await seedSyntheticSubject(ERASURE, doorsFor(scenario), {
      workspaceId: scenario.workspaceId,
    });

    const rehearsed = await rehearsing(scenario);

    expect(rehearsed.tokens).toEqual(expectedTokensFor(scenario.workspaceId));
  });

  it("refuses a workspace nothing was seeded into, rather than erasing whoever else is there", async () => {
    const scenario = await arrange();

    const rehearsed = await rehearseErasure(ERASURE, doorsFor(scenario), {
      workspaceId: scenario.workspaceId,
    });

    expect(rehearsed.ok).toBe(false);
    expect(rehearsed.ok ? undefined : rehearsed.error).toBe("not-seeded");
  });

  it("answers with the routine's own report, word for word", async () => {
    const scenario = await arrange();
    await seeding(scenario);

    const { report, subjectRequestId } = await rehearsing(scenario);

    expect(report).toContain(`Erasure report for subject request ${subjectRequestId}.`);
    // ADR 0020's amendment of 30/08/2026, in place of any wording implying total erasure.
    expect(report).toContain(
      "Every actor identifier for this person has been rewritten across the repository's history, " +
        "the index, the evidence and the map, and in the backup copies listed below.",
    );
    // The backups amendment of 28/08/2026, with the four dates from the lock instant.
    expect(report).toContain(
      "Backup copies taken before 2026-06-01T12:00:00.000Z are beyond use: restored only in a " +
        "disaster, encrypted at rest, deletable only by the escrowed credential, expiring on " +
        `${BEYOND_USE}.`,
    );
    expect(report).toContain(
      "The object store is untouched: a company document that mentions a person is suppressed " +
        "when it is next reprocessed, never deleted.",
    );
    expect(report).toContain("Exports already issued are not recalled. None have been issued.");
  });

  it("leaves no token in any object the bundle still reaches, and no identity row for the subject", async () => {
    const scenario = await arrange();
    const subject = await seeding(scenario);

    await rehearsing(scenario);

    const objectsHeld = await everyObjectOf(scenario.git, scenario.workspaceId);
    for (const token of subject.tokens) expect(objectsHeld).not.toContain(token);
    // The id stands, because every ledger row names it; everything they were recognised by goes.
    const after = await personRow(subject.personId);
    expect(after?.name).toBe("");
    expect(after?.email).not.toContain(subject.email);
    expect(await membershipRows(scenario.workspaceId, subject.personId)).toEqual([]);
  });

  it("records one act under the platform principal, carrying ids and a count and no token", async () => {
    const scenario = await arrange();
    const subject = await seeding(scenario);

    const rehearsed = await rehearsing(scenario);

    const rows = await ledgerRowsOf(db().pool, scenario.workspaceId, REHEARSED);
    expect(rows).toEqual([
      {
        id: rehearsed.auditEventId,
        actor: ERASURE_ACTOR,
        subject_id: rehearsed.erasureRequestId,
        detail: {
          erasureRequestId: rehearsed.erasureRequestId,
          subjectRequestId: rehearsed.subjectRequestId,
          personId: subject.personId,
          tokens: 3,
        },
      },
    ]);
    const written = JSON.stringify(rows);
    for (const token of subject.tokens) expect(written).not.toContain(token);
  });
});
