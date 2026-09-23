import { describe, expect, it } from "vitest";

import { writeConcept } from "../src/concepts/index.ts";
import {
  ERASURE,
  rehearseErasure,
  seedSyntheticSubject,
  type ErasureRehearsed,
  type SyntheticSubject,
} from "../src/erasure/index.ts";
import { revokeCredentials } from "../src/workspaces/index.ts";
import { bundleHistory, everyObjectOf, fileAtCommit } from "./bundle.ts";
import { bootstrap } from "./platform.ts";
import { ledgerRowsOf } from "./sourced-concept.ts";
import { objectStoreForSuite } from "./suite-objects.ts";
import { doorsOf, suiteWithBundles, type Scenario } from "./workspace-with-bundle.ts";

const { db, arrange } = suiteWithBundles();

const objects = objectStoreForSuite();

const REHEARSED_AT = new Date("2026-06-01T12:00:00.000Z");

const REVOKED_AFTER_THE_SEED = new Date("2026-06-01T12:00:01.000Z");

const BEYOND_USE =
  "2026-06-03T12:00:00.000Z · 2026-07-01T12:00:00.000Z · " +
  "2026-07-27T12:00:00.000Z · 2026-12-01T12:00:00.000Z";

const ERASURE_ACTOR = "process:better-answers-erasure";

const REHEARSED = "platform.erasure.rehearsed";

const CONCEPT_PATH = "knowledge/erasure-rehearsal.md";

const doorsFor = (scenario: Scenario, at: Date = REHEARSED_AT) => ({
  git: scenario.git,
  postgres: scenario.postgres,
  objects: objects().door,
  clock: { now: () => at },
  log: { info: () => undefined },
});

const expectedTokensFor = (workspaceId: string): readonly string[] => {
  const email = `subject-${workspaceId.toLowerCase()}@erasure-rehearsal.example.test`;
  return [email, `human:${email}`, `Rehearsal subject ${workspaceId}`];
};

const seeding = async (scenario: Scenario): Promise<SyntheticSubject> => {
  const seeded = await seedSyntheticSubject(ERASURE, doorsFor(scenario), {
    workspaceId: scenario.workspaceId,
  });
  if (!seeded.ok) throw new Error(`the seed refused: ${String(seeded.error)}`);
  return seeded.value;
};

const rehearsing = async (scenario: Scenario): Promise<ErasureRehearsed> => {
  const rehearsed = await rehearseErasure(ERASURE, doorsFor(scenario), {
    workspaceId: scenario.workspaceId,
  });
  if (!rehearsed.ok) throw new Error(`the rehearsal refused: ${String(rehearsed.error)}`);
  return rehearsed.value;
};

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

  it("is the same subject the second time, because a drill phase re-run is not a second person, and makes no second commit", async () => {
    const scenario = await arrange();

    const first = await seeding(scenario);
    const second = await seeding(scenario);

    expect(second.personId).toBe(first.personId);
    expect(second.tokens).toEqual(first.tokens);
    expect(await membershipRows(scenario.workspaceId, first.personId)).toHaveLength(1);
    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toHaveLength(1);
  });

  it("refuses to seed a workspace where another concept holds the drill's path, with the bundle's head where it was, rather than reporting it seeded", async () => {
    const scenario = await arrange();
    const other = await writeConcept(scenario.editor, doorsOf(scenario), {
      mergeKey: "Note:not the drill",
      path: CONCEPT_PATH,
      kind: "Note",
      title: "Not the drill",
      frontmatter: { title: "Not the drill", type: "Note" },
      body: "A note somebody left at the drill's path.",
      message: "Record a note at the drill's path",
      author: { name: "Ada Editor", email: "ada@acme.invalid" },
      expects: { head: null },
    });
    if (!other.ok) throw new Error(`the note was refused: ${String(other.error)}`);

    const seeded = await seedSyntheticSubject(ERASURE, doorsFor(scenario), {
      workspaceId: scenario.workspaceId,
    });

    expect(seeded).toEqual({
      ok: false,
      error: new Error("erasure: the rehearsal's concept was refused: path-taken"),
    });
    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toEqual([other.value.sha]);
  });
});

describe("the rehearsal", () => {
  it("finds the subject the seed left in the rows, so a dump may be taken between the two phases", async () => {
    const scenario = await arrange();

    await seedSyntheticSubject(ERASURE, doorsFor(scenario), {
      workspaceId: scenario.workspaceId,
    });

    const rehearsed = await rehearsing(scenario);

    expect(rehearsed.tokens).toEqual(expectedTokensFor(scenario.workspaceId));
  });

  it("names a principal its door refused as the subject's, never as a refusal of the request", async () => {
    const scenario = await arrange();
    const subject = await seeding(scenario);
    const revoked = await revokeCredentials(bootstrap, scenario.postgres, {
      userId: subject.personId,
      at: REVOKED_AFTER_THE_SEED,
    });
    if (!revoked.ok) throw new Error(`the revocation refused: ${String(revoked.error)}`);

    const rehearsed = await rehearseErasure(ERASURE, doorsFor(scenario), {
      workspaceId: scenario.workspaceId,
    });

    expect(rehearsed).toEqual({
      ok: false,
      error: new Error(
        "erasure: the synthetic subject's principal was refused: credentials-revoked",
      ),
    });
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

    expect(report).toContain(
      "Every actor identifier for this person has been rewritten across the repository's history, " +
        "the index, the evidence and the map, and in the backup copies listed below.",
    );

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
