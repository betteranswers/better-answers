import { describe, expect, it } from "vitest";

import { writeConcept } from "../src/concepts/index.ts";
import {
  ERASURE,
  rehearseErasure,
  seedSyntheticSubject,
  type ErasureRehearsed,
} from "../src/erasure/index.ts";
import { getObject } from "../src/store/objects/index.ts";
import { revokeCredentials, revokeCredentialsInput } from "../src/workspaces/index.ts";
import { bundleHistory, everyObjectOf, fileAtCommit } from "./bundle.ts";
import { erasureDoorsFor } from "./erasure-doors.ts";
import { asANewOperator } from "./platform.ts";
import { auditEventRowsOf } from "./sourced-concept.ts";
import { inputOf } from "./suite-input.ts";
import { objectStoreForSuite, textOf } from "./suite-objects.ts";
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

const doorsFor = (scenario: Scenario, at: Date = REHEARSED_AT) =>
  erasureDoorsFor(scenario, objects().door, at);

const expectedTokensFor = (workspaceId: string): readonly string[] => {
  const email = `subject-${workspaceId.toLowerCase()}@erasure-rehearsal.example.test`;
  return [email, `human:${email}`, `Rehearsal subject ${workspaceId}`];
};

const seeding = async (scenario: Scenario) => {
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

const originalOf = async (scenario: Scenario, documentId: string): Promise<string> => {
  const read = await db().pool.query<{ original_key: string }>(
    "SELECT original_key FROM source_document WHERE workspace_id = $1 AND id = $2",
    [scenario.workspaceId, documentId],
  );
  const key = read.rows[0]?.original_key;
  if (key === undefined) throw new Error(`no document ${documentId} was bound`);
  const got = await getObject(scenario.admin, objects().door, key);
  if (!got.ok) throw new Error(`the original was not readable: ${got.error}`);
  return textOf(got.value);
};

const jobRow = async (workspaceId: string, jobId: string) => {
  const read = await db().pool.query<Record<string, unknown>>(
    "SELECT kind, subject_id, reason, status FROM job WHERE workspace_id = $1 AND id = $2",
    [workspaceId, jobId],
  );
  return read.rows[0];
};

const bindingsIn = async (workspaceId: string): Promise<readonly string[]> => {
  const read = await db().pool.query<{ id: string }>(
    "SELECT id FROM source_binding WHERE workspace_id = $1",
    [workspaceId],
  );
  return read.rows.map((row) => row.id);
};

describe("the seed", () => {
  it("writes one synthetic member and answers the tokens to grep", async () => {
    const scenario = await arrange();
    const [email, named, name] = expectedTokensFor(scenario.workspaceId);

    const subject = await seeding(scenario);

    expect(subject.tokens).toEqual([email, named, name]);
    expect(await personRow(subject.personId)).toEqual({ name, email });
    expect(await membershipRows(scenario.workspaceId, subject.personId)).toEqual([
      { role: "Admin" },
    ]);
  });

  it("binds a document naming the subject, queueing its index run", async () => {
    const scenario = await arrange();
    const [email, , name] = expectedTokensFor(scenario.workspaceId);

    const { document } = await seeding(scenario);

    expect(await originalOf(scenario, document.documentId)).toBe(
      "# Erasure rehearsal\n\n" +
        `The drill's synthetic document. It names the rehearsal's subject, ${name}, ` +
        `who works at ${email}.\n`,
    );
    expect(await jobRow(scenario.workspaceId, document.indexJobId)).toEqual({
      kind: "index",
      subject_id: document.bindingId,
      reason: "bound",
      status: "queued",
    });
  });

  it("binds a new document for a subject seeded after erasure", async () => {
    const scenario = await arrange();
    const erased = await seeding(scenario);
    await rehearsing(scenario);

    const next = await seeding(scenario);

    expect(next.personId).not.toBe(erased.personId);
    expect(next.document.bindingId).not.toBe(erased.document.bindingId);
    expect(await jobRow(scenario.workspaceId, next.document.indexJobId)).toEqual({
      kind: "index",
      subject_id: next.document.bindingId,
      reason: "bound",
      status: "queued",
    });
    expect(await bindingsIn(scenario.workspaceId)).toHaveLength(2);
  });

  it("names the subject in the concept file in rewritable form", async () => {
    const scenario = await arrange();
    const [, named] = expectedTokensFor(scenario.workspaceId);

    await seeding(scenario);

    const history = await bundleHistory(scenario.git, scenario.workspaceId);
    const sha = history.at(-1) ?? "";
    const file = await fileAtCommit(scenario.git, scenario.workspaceId, sha, CONCEPT_PATH);
    expect(file).toContain(named);
  });

  it("seeds the same subject again, with no second commit", async () => {
    const scenario = await arrange();

    const first = await seeding(scenario);
    const second = await seeding(scenario);

    expect(second.personId).toBe(first.personId);
    expect(second.tokens).toEqual(first.tokens);
    expect(second.document).toEqual(first.document);
    expect(await membershipRows(scenario.workspaceId, first.personId)).toHaveLength(1);
    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toHaveLength(1);
    expect(await bindingsIn(scenario.workspaceId)).toEqual([first.document.bindingId]);
  });

  it("refuses where another concept holds the drill's path, head unmoved", async () => {
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
  it("finds the subject the seed left in the rows", async () => {
    const scenario = await arrange();

    await seedSyntheticSubject(ERASURE, doorsFor(scenario), {
      workspaceId: scenario.workspaceId,
    });

    const rehearsed = await rehearsing(scenario);

    expect(rehearsed.tokens).toEqual(expectedTokensFor(scenario.workspaceId));
  });

  it("names a refused principal as the subject's, not the request's", async () => {
    const scenario = await arrange();
    const subject = await seeding(scenario);
    const { personId } = inputOf(revokeCredentialsInput, { personId: subject.personId });
    const { answered } = await asANewOperator(db(), REVOKED_AFTER_THE_SEED, (operator, tx) =>
      revokeCredentials(operator, tx, { personId, at: REVOKED_AFTER_THE_SEED }),
    );
    const revoked = answered.ok ? answered.value : answered;
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

  it("refuses a workspace nothing was seeded into", async () => {
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
      "The original files in the object store are untouched; the identifiers named in this " +
        "request are withheld from the text of every document in this workspace, those held now " +
        "and those bound later, each time a document is indexed; and the documents found above " +
        "are indexed again now.",
    );
    expect(report).toContain("Exports already issued are not recalled. None have been issued.");
  });

  it("leaves no token in the bundle and no identity row", async () => {
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

  it("records one act under the platform principal, carrying no token", async () => {
    const scenario = await arrange();
    const subject = await seeding(scenario);

    const rehearsed = await rehearsing(scenario);

    const rows = await auditEventRowsOf(db().pool, scenario.workspaceId, REHEARSED);
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
