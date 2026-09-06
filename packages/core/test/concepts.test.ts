import { testData } from "@better-answers/schema/testing";
import { describe, expect, it } from "vitest";

import { ulid } from "@better-answers/schema";

import { open } from "../src/answering/index.ts";
import {
  contentHashOf,
  conceptByIri,
  writeConcept,
  type WriteConceptInput,
} from "../src/concepts/index.ts";
import type { Result, Role, UserPrincipal } from "../src/kernel/index.ts";
import {
  head,
  initRepository,
  PLATFORM_BOT,
  withRepositoryLock,
  type GitDoor,
} from "../src/store/git/index.ts";
import {
  openPostgres,
  type PostgresDoor,
  type Tx,
  withPrincipal,
} from "../src/store/postgres/index.ts";
import { provisionWorkspace } from "../src/workspaces/index.ts";
import { bundleHistory, bundlesForSuite, commitFacts, fileAtCommit } from "./bundle.ts";
import { bootstrap, seedPerson } from "./platform.ts";
import { postgresForSuite } from "./suite-postgres.ts";

/**
 * The governed write through the concepts slice's entry point (`[TEST1]`), against real
 * Postgres and a real bare repository: **one act, one commit, one transaction** (ADR 0012).
 *
 * The claims this suite exists for are the ones no unit test can make. That the commit is
 * the person's and the platform's at once, that a stale precondition is refused loudly, that
 * the lock makes two acts on one bundle one after the other, and — the load-bearing one —
 * that a failure after the commit leaves **no partial rows and a head ahead of the last
 * `bundle_commit`**, which is exactly the state T-056's reconciler is defined to find. Each
 * of those is a claim about two stores at once, so the seam is the slice over both of them.
 */

const db = postgresForSuite();
const bundles = bundlesForSuite();

/**
 * A workspace with its bundle and three people in it — the arrange block every test here
 * opens with. Provisioning, the two extra memberships and the repository are one call
 * because a governed write needs all four before it can happen at all, and a test that said
 * so in four lines would say it in four lines eleven times.
 */
type Scenario = {
  readonly workspaceId: string;
  readonly postgres: PostgresDoor;
  readonly git: GitDoor;
  /** The Editor every write here is made by, unless a test names another role. */
  readonly editor: UserPrincipal;
  readonly viewer: UserPrincipal;
  readonly admin: UserPrincipal;
};

const principalFor = async (
  postgres: PostgresDoor,
  workspaceId: string,
  userId: string,
): Promise<UserPrincipal> => {
  // The Principal a transport resolves and hands to the act: it outlives the resolving
  // transaction on purpose — the governed write opens its own, which is the whole point of
  // `withMembership` re-reading the membership inside it.
  const resolved = await withPrincipal(
    openPostgres(db().runtimePool),
    { workspaceId, userId, issuedAt: new Date() },
    async (principal) => principal,
  );
  if (!resolved.ok) throw new Error(`the principal did not resolve: ${resolved.error}`);
  return resolved.value;
};

const arrange = async (): Promise<Scenario> => {
  const adminUserId = await seedPerson(db().pool);
  const postgres = openPostgres(db().runtimePool);
  const workspaceId = ulid();
  const provisioned = await provisionWorkspace(bootstrap, postgres, {
    id: workspaceId,
    name: "Acme",
    slug: `acme-${workspaceId.toLowerCase()}`,
    adminUserId,
  });
  expect(provisioned.ok).toBe(true);

  const client = await db().pool.connect();
  const people: Record<string, string> = {};
  try {
    const seed = testData(client);
    for (const role of ["Editor", "Viewer"] satisfies Role[]) {
      const person = await seed.user();
      await seed.member({ workspaceId, userId: person.id, role });
      people[role] = person.id;
    }
  } finally {
    client.release();
  }

  const git = bundles();
  await initRepository(git, workspaceId);
  return {
    workspaceId,
    postgres,
    git,
    editor: await principalFor(postgres, workspaceId, people["Editor"] ?? ""),
    viewer: await principalFor(postgres, workspaceId, people["Viewer"] ?? ""),
    admin: await principalFor(postgres, workspaceId, adminUserId),
  };
};

let minted = 0;
/** A concept's IRI, minted the way the caller that knows the platform's origin would. */
const iriFor = (slug: string): string =>
  `https://knowledge.better-answers.test/c/${slug}-${(minted += 1)}`;

const writeFor = (overrides: Partial<WriteConceptInput> = {}): WriteConceptInput => ({
  iri: iriFor("expenses"),
  mergeKey: `policy:expenses-${minted}`,
  path: `knowledge/expenses-${minted}.md`,
  kind: "Policy",
  title: "Expenses",
  frontmatter: { title: "Expenses", type: "Policy", sources: ["Handbook.pdf#p.4"] },
  body: "Expenses are claimed within thirty days.",
  message: "Record the expenses policy",
  author: { name: "Ada Editor", email: "ada@acme.invalid" },
  expectedHead: null,
  sensitivity: "Internal",
  ...overrides,
});

const write = (scenario: Scenario, principal: UserPrincipal, input: WriteConceptInput) =>
  writeConcept(principal, { git: scenario.git, postgres: scenario.postgres }, input);

/**
 * The Editor's write, and what it landed. A test that is about the commit, the rows or the
 * read has no business restating "and it was not refused" in four lines; a test that is
 * about a refusal calls `write` above and reads the refusal itself.
 */
const landed = async (scenario: Scenario, input: WriteConceptInput) => {
  const result = await write(scenario, scenario.editor, input);
  if (!result.ok) throw new Error(`the write was refused: ${String(result.error)}`);
  return result.value;
};

/** Every row the act writes, counted as the superuser so the policy cannot hide a survivor. */
const rowsFor = async (workspaceId: string) => {
  const counted = await db().pool.query<Record<string, string>>(
    `SELECT (SELECT count(*) FROM concept_identity WHERE workspace_id = $1) AS identities,
            (SELECT count(*) FROM concept_index WHERE workspace_id = $1) AS concepts,
            (SELECT count(*) FROM bundle_commit WHERE workspace_id = $1) AS commits,
            (SELECT count(*) FROM evidence WHERE workspace_id = $1) AS evidence,
            (SELECT count(*) FROM audit_event WHERE workspace_id = $1) AS events`,
    [workspaceId],
  );
  return counted.rows[0];
};

/** The shas `bundle_commit` knows about, oldest first — the prefix of git history it must be. */
const recordedCommits = async (workspaceId: string): Promise<readonly string[]> => {
  const rows = await db().pool.query<{ sha: string }>(
    "SELECT sha FROM bundle_commit WHERE workspace_id = $1 ORDER BY committed_at, sha",
    [workspaceId],
  );
  return rows.rows.map((row) => row.sha);
};

/** Run a read as this person, inside one transaction, the way a transport would. */
const reading = async <T>(
  principal: UserPrincipal,
  work: (principal: UserPrincipal, tx: Tx) => Promise<T>,
): Promise<T> => {
  const read = await withPrincipal(
    openPostgres(db().runtimePool),
    { workspaceId: principal.workspaceId, userId: principal.userId, issuedAt: new Date() },
    work,
  );
  if (!read.ok) throw new Error(`the principal did not resolve: ${read.error}`);
  return read.value;
};

describe("a governed write", () => {
  it("lands one commit with the person as author and the platform bot as committer", async () => {
    const scenario = await arrange();
    const input = writeFor();

    const written = await landed(scenario, input);

    const facts = await commitFacts(scenario.git, scenario.workspaceId, written.sha);
    expect({ subject: facts.subject, author: facts.author, committer: facts.committer }).toEqual({
      subject: "Record the expenses policy",
      author: "Ada Editor <ada@acme.invalid>",
      committer: `${PLATFORM_BOT.name} <${PLATFORM_BOT.email}>`,
    });
    expect(facts.parents).toEqual([]);
    expect(facts.files).toEqual([input.path]);
  });

  it("carries the actor and the audit id in its trailers, and the audit id was minted before the commit", async () => {
    const scenario = await arrange();

    const written = await landed(scenario, writeFor());

    const facts = await commitFacts(scenario.git, scenario.workspaceId, written.sha);
    // The `Actor:` trailer is the kernel's ActorId — the person id, never their address,
    // which is what the git author line above carries instead (ADR 0035, `[AUDIT3]`).
    expect(facts.trailers).toEqual({
      Actor: `human:${scenario.editor.userId}`,
      Audit: written.auditEventId,
    });
    // Minted before the commit: the ledger row, the commit's trailer and the
    // `bundle_commit` row all hold the same id, which is what makes a replay idempotent.
    const joined = await db().pool.query<{ act: string; sha: string }>(
      `SELECT e.act, c.sha
         FROM audit_event e JOIN bundle_commit c
           ON c.workspace_id = e.workspace_id AND c.audit_event_id = e.id
        WHERE e.id = $1`,
      [written.auditEventId],
    );
    expect(joined.rows).toEqual([{ act: "knowledge.concept.committed", sha: written.sha }]);
  });

  it("writes the file to the bundle with its frontmatter, its body and its own IRI", async () => {
    const scenario = await arrange();
    const input = writeFor();

    const written = await landed(scenario, input);

    const file = await fileAtCommit(scenario.git, scenario.workspaceId, written.sha, input.path);
    expect(file).toBe(
      [
        "---",
        'title: "Expenses"',
        'type: "Policy"',
        "sources:",
        '  - "Handbook.pdf#p.4"',
        `iri: "${input.iri}"`,
        "---",
        "",
        "Expenses are claimed within thirty days.",
        "",
      ].join("\n"),
    );
    // The hash on the row is the content's, not the file's: the trust keys and the IRI are
    // left out of it (ADR 0014), so recording a check never moves it.
    expect(written.contentHash).toBe(contentHashOf(input.frontmatter, input.body));
  });

  it("records the concept, its identity, the commit and its evidence in one transaction", async () => {
    const scenario = await arrange();
    const input = writeFor({
      evidence: [
        { sourceDocumentId: ulid(), locator: "p.4#para-2", resource: "Handbook (2026)" },
        { sourceDocumentId: ulid(), locator: "p.9", resource: "Handbook (2026)" },
      ],
    });

    const written = await landed(scenario, input);

    expect(await rowsFor(scenario.workspaceId)).toEqual({
      identities: "1",
      concepts: "1",
      commits: "1",
      evidence: "2",
      // The workspace's provisioning wrote the first, this act the second.
      events: "2",
    });
    const row = await db().pool.query<Record<string, unknown>>(
      "SELECT iri, path, kind, title, content_hash, commit_sha, status, sensitivity, audience FROM concept_index WHERE workspace_id = $1",
      [scenario.workspaceId],
    );
    expect(row.rows).toEqual([
      {
        iri: input.iri,
        path: input.path,
        kind: "Policy",
        title: "Expenses",
        content_hash: written.contentHash,
        commit_sha: written.sha,
        status: "draft",
        sensitivity: "Internal",
        audience: "everyone",
      },
    ]);
  });

  it("keeps the recorded commits a prefix of the bundle's history across a chain of acts", async () => {
    const scenario = await arrange();
    let expectedHead: string | null = null;
    const shas: string[] = [];
    for (const title of ["Expenses", "Travel", "Leave"]) {
      const written = await landed(scenario, writeFor({ title, expectedHead }));
      shas.push(written.sha);
      expectedHead = written.sha;
    }

    // The invariant the lock buys and the reconciler leans on: what Postgres knows and what
    // git holds are the same list, in the same order (ADR 0012's 2026-09-06 amendment).
    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toEqual(shas);
    expect(await recordedCommits(scenario.workspaceId)).toEqual(shas);
    const parents = await db().pool.query<{ sha: string; parent_sha: string | null }>(
      "SELECT sha, parent_sha FROM bundle_commit WHERE workspace_id = $1 ORDER BY committed_at, sha",
      [scenario.workspaceId],
    );
    expect(parents.rows.map((row) => row.parent_sha)).toEqual([null, shas[0], shas[1]]);
  });
});

describe("what a governed write refuses", () => {
  it("refuses a write against a head that has moved, loudly and without a commit", async () => {
    const scenario = await arrange();
    await landed(scenario, writeFor());

    // The second write was written against an empty bundle, which is no longer what the
    // ref holds: the person is told, rather than silently overwriting the first.
    const stale = await write(scenario, scenario.editor, writeFor({ expectedHead: null }));

    expect(stale).toEqual({ ok: false, error: "stale-precondition" });
    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toHaveLength(1);
    expect(await recordedCommits(scenario.workspaceId)).toHaveLength(1);
  });

  it("refuses a Viewer before anything is committed", async () => {
    const scenario = await arrange();

    const refused = await write(scenario, scenario.viewer, writeFor());

    expect(refused).toEqual({ ok: false, error: "role-forbids" });
    expect(await head(scenario.git, scenario.workspaceId)).toBeNull();
    expect(await rowsFor(scenario.workspaceId)).toMatchObject({ concepts: "0", commits: "0" });
  });

  it("refuses a workspace with no bundle, rather than making one nobody asked for", async () => {
    const scenario = await arrange();
    const elsewhere = { ...scenario.editor, workspaceId: ulid() as UserPrincipal["workspaceId"] };

    const refused = await write(scenario, elsewhere, writeFor());

    expect(refused).toEqual({ ok: false, error: "no-such-repository" });
  });

  // A second concept at a path the bundle already holds is refused too — `path-taken` —
  // and it is asserted where its whole consequence is: the first test below, which reads
  // the refusal *and* the state it leaves in both stores.
});

/** What a refused act leaves behind: no rows of its own, and every commit it made still there. */
const expectCommitsWithoutRows = async (scenario: Scenario, commits: number): Promise<void> => {
  expect(await rowsFor(scenario.workspaceId)).toMatchObject({ concepts: "0", commits: "0" });
  expect(await bundleHistory(scenario.git, scenario.workspaceId)).toHaveLength(commits);
};

/**
 * The window ADR 0012's amendment governs: between the commit and the act's transaction. A
 * failure there is not a bug to be prevented — it is the state the reconciler is defined
 * for, and these are the tests that say what it looks like.
 */
describe("a failure after the commit", () => {
  it("leaves no partial rows, and a head ahead of the last recorded commit", async () => {
    const scenario = await arrange();
    const first = writeFor();
    const written = await landed(scenario, first);
    const before = await rowsFor(scenario.workspaceId);

    // A second concept at a path the index already holds: the commit is made — the file is
    // real and git accepted it — and then the unique index refuses the row.
    const clash = await write(
      scenario,
      scenario.editor,
      writeFor({ path: first.path, expectedHead: written.sha }),
    );

    // `[TEST8]`: the rows are asserted before the returned value, because a statement that
    // failed inside a transaction is only proved by what the transaction left. Nothing
    // landed — not the identity, not the index row, not the commit row, and not the ledger
    // row, which was written first inside the transaction, so this proves it rolled back
    // with the act rather than that it was never reached (`[AUDIT1]`).
    expect(await rowsFor(scenario.workspaceId)).toEqual(before);
    // And the shape the reconciler finds: git is one commit ahead of what Postgres knows.
    const history = await bundleHistory(scenario.git, scenario.workspaceId);
    const recorded = await recordedCommits(scenario.workspaceId);
    expect(history).toHaveLength(2);
    expect(recorded).toEqual([history[0]]);
    expect(await head(scenario.git, scenario.workspaceId)).toBe(history[1]);
    expect(clash).toEqual({ ok: false, error: "path-taken" });
  });

  it("refuses the rows when the writer's role moved while the commit was being made", async () => {
    const scenario = await arrange();
    // The revocation race, arranged the only honest way: the Principal was resolved as an
    // Editor and the membership says Viewer by the time the act's transaction opens. The
    // door re-reads the membership inside that transaction, so the rows refuse.
    await db().pool.query(
      "UPDATE member SET role = 'Viewer' WHERE workspace_id = $1 AND user_id = $2",
      [scenario.workspaceId, scenario.editor.userId],
    );

    const refused = await write(scenario, scenario.editor, writeFor());

    expect(refused).toEqual({ ok: false, error: "role-disagrees" });
    // Authorization is judged at time-of-act: the commit stands, and the reconciler replays
    // it under its own principal (ADR 0012's 2026-09-06 amendment). Unwanted-but-authorized
    // content is undone by a forward revert, never by rewriting this history.
    await expectCommitsWithoutRows(scenario, 1);
  });

  it("refuses the rows when the writer's membership ended while the commit was being made", async () => {
    const scenario = await arrange();
    await db().pool.query("DELETE FROM member WHERE workspace_id = $1 AND user_id = $2", [
      scenario.workspaceId,
      scenario.editor.userId,
    ]);

    const refused = await write(scenario, scenario.editor, writeFor());

    expect(refused).toEqual({ ok: false, error: "not-a-member" });
    await expectCommitsWithoutRows(scenario, 1);
  });
});

describe("the per-repository lock", () => {
  it("runs one act at a time per bundle, and lets another bundle's act through beside it", async () => {
    const door = bundles();
    const one = ulid();
    const other = ulid();
    const order: string[] = [];
    const held = async (workspaceId: string, name: string): Promise<void> =>
      withRepositoryLock(door, workspaceId, async () => {
        order.push(`${name} in`);
        await new Promise((resolve) => setTimeout(resolve, 20));
        order.push(`${name} out`);
      });

    await Promise.all([held(one, "first"), held(one, "second"), held(other, "elsewhere")]);

    // The two acts on one bundle never overlap; the third is on another bundle and is not
    // serialised against them, which is why the lock is per repository and not global.
    const sameBundle = order.filter((step) => !step.startsWith("elsewhere"));
    expect(sameBundle).toEqual(["first in", "first out", "second in", "second out"]);
    expect(order).toContain("elsewhere out");
  });

  it("holds the bundle through the whole act, so two writes racing one head leave one commit", async () => {
    const scenario = await arrange();

    // Both were written against an empty bundle. Without the lock spanning the act, both
    // could read the same head; with it, the second sees what the first left and is refused.
    const [first, second] = await Promise.all([
      write(scenario, scenario.editor, writeFor()),
      write(scenario, scenario.editor, writeFor()),
    ]);

    expect([first?.ok, second?.ok].toSorted()).toEqual([false, true]);
    const refused = first?.ok === false ? first : second;
    expect(refused).toEqual({ ok: false, error: "stale-precondition" });
    const history = await bundleHistory(scenario.git, scenario.workspaceId);
    expect(history).toHaveLength(1);
    expect(await recordedCommits(scenario.workspaceId)).toEqual(history);
  });

  it("releases the bundle when an act fails, so the next act is not blocked behind it", async () => {
    const scenario = await arrange();
    const failed = await write(scenario, scenario.viewer, writeFor());
    expect(failed.ok).toBe(false);

    // The lock is free rather than held by the act that failed inside it.
    expect((await landed(scenario, writeFor())).sha).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe("opening a concept by IRI", () => {
  it("hands the reader the concept the write committed, unchecked until somebody checks it", async () => {
    const scenario = await arrange();
    const input = writeFor();
    await landed(scenario, input);

    const opened = await reading(scenario.viewer, (principal, tx) =>
      open(principal, tx, { iri: input.iri }),
    );

    expect(opened.ok).toBe(true);
    if (!opened.ok || !opened.value.found) return;
    expect(opened.value.concept).toEqual({
      iri: input.iri,
      frontmatter: { ...input.frontmatter, iri: input.iri },
      body: input.body,
      relations: [],
      trust: {
        tier: "unverified",
        status: "draft",
        checkedBy: null,
        checkedAt: null,
        rider: null,
      },
      evidence: [{ locator: "p.4", source: "Handbook.pdf" }],
    });
  });

  it("reads a person's check off the verification record, and says so when the content moved", async () => {
    const scenario = await arrange();
    const input = writeFor({ status: "stable" });
    const written = await landed(scenario, input);
    const client = await db().pool.connect();
    try {
      await testData(client).conceptVerification({
        workspaceId: scenario.workspaceId,
        iri: input.iri,
        actor: `human:${scenario.admin.userId}`,
        contentHash: written.contentHash,
      });
    } finally {
      client.release();
    }

    const checked = await reading(scenario.viewer, (principal, tx) =>
      conceptByIri(principal, tx, input.iri),
    );
    expect(checked).toMatchObject({ ok: true });
    const opened = await reading(scenario.viewer, (principal, tx) =>
      open(principal, tx, { iri: input.iri }),
    );
    expect(opened.ok && opened.value.found && opened.value.concept?.trust).toMatchObject({
      tier: "human-reviewed",
      status: "current",
      checkedBy: `human:${scenario.admin.userId}`,
    });

    // The same concept written again moves the content hash past the check's, and the trust
    // status says so without anybody recording anything (ADR 0019).
    await landed(
      scenario,
      writeFor({
        iri: input.iri,
        mergeKey: input.mergeKey,
        path: input.path,
        status: "stable",
        body: "Expenses are claimed within sixty days.",
        expectedHead: written.sha,
      }),
    );
    const moved = await reading(scenario.viewer, (principal, tx) =>
      open(principal, tx, { iri: input.iri }),
    );
    expect(moved.ok && moved.value.found && moved.value.concept?.trust.status).toBe(
      "changed-since-checked",
    );
  });

  it("withholds a Restricted concept from a Viewer exactly as it answers an IRI nobody minted", async () => {
    const scenario = await arrange();
    const input = writeFor({ sensitivity: "Restricted" });
    await landed(scenario, input);

    const withheld = await reading(scenario.viewer, (principal, tx) =>
      open(principal, tx, { iri: input.iri }),
    );
    const absent = await reading(scenario.viewer, (principal, tx) =>
      open(principal, tx, { iri: iriFor("never-minted") }),
    );

    // Indistinguishable, which is the whole requirement: the same shape, and neither says
    // anything a caller could probe with (user story 13).
    expect(withheld).toEqual({ ok: true, value: { found: false, iri: input.iri } });
    expect(absent.ok && absent.value.found).toBe(false);
    // The Admin, who may see it, is the proof the concept is really there.
    const seen = await reading(scenario.admin, (principal, tx) =>
      open(principal, tx, { iri: input.iri }),
    );
    expect(seen.ok && seen.value.found).toBe(true);
  });

  it("never reaches another workspace's concept, whoever asks", async () => {
    const here = await arrange();
    const there = await arrange();
    const input = writeFor();
    await landed(there, input);

    const reached: Result<unknown, unknown> = await reading(here.admin, (principal, tx) =>
      conceptByIri(principal, tx, input.iri),
    );

    expect(reached).toEqual({ ok: true, value: undefined });
  });
});
