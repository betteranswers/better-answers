import { describe, expect, it } from "vitest";
import { z } from "zod";

import { conceptIriOf, ulid } from "@better-answers/schema";

import {
  acceptSuggestions,
  contentHashOf,
  declineSuggestion,
  parseConceptFile,
  reconcile,
  reconcileEveryWorkspace,
  RECONCILER,
  reconcilerHits,
  renderConceptFile,
  submitSuggestionSet,
  suggestionSetSummary,
  writeConcept,
  writeManifest,
  type Frontmatter,
  type Reconciled,
  type SuggestionRequest,
  type WriteConceptInput,
} from "../src/concepts/index.ts";
import { actorIdOf, type Result, type UserPrincipal } from "../src/kernel/index.ts";
import { narrowBinding, narrowBindingInput } from "../src/sources/index.ts";
import { inputOf } from "./suite-input.ts";
import { commit, withRepositoryLock } from "@better-answers/core/store/git";
import {
  bundleHistory,
  commitFacts,
  divergeHistory,
  fileAtCommit,
  removeRepository,
} from "./bundle.ts";
import { bindingHolding, publishedOnceIndexed } from "./sourced-concept.ts";
import { readingAs } from "./suite-postgres.ts";
import { doorsOf, suiteWithBundles, type Scenario } from "./workspace-with-bundle.ts";

const { db, arrange } = suiteWithBundles();

let written = 0;

const guideline = (
  title: string,
  overrides: Partial<WriteConceptInput> = {},
): WriteConceptInput => {
  written += 1;
  return {
    mergeKey: `guideline:${title.toLowerCase()}-${written}`,
    path: `knowledge/guidelines/${title.toLowerCase()}-${written}.md`,
    kind: "Guideline",
    title,
    frontmatter: { title, type: "Guideline", tags: ["finance", "travel"] },
    body: `# ${title}\n\nBook through the platform, and claim within a month.`,
    message: `Record the ${title.toLowerCase()} guideline`,
    author: { name: "Grace Editor", email: "grace@acme.invalid" },
    expects: { head: null },
    status: "stable",
    sensitivity: "Internal",
    ...overrides,
  };
};

const landed = async (scenario: Scenario, principal: UserPrincipal, input: WriteConceptInput) => {
  const result = await writeConcept(principal, doorsOf(scenario), input);
  if (!result.ok) throw new Error(`the write was refused: ${String(result.error)}`);
  return result.value;
};

const openTheWindow = async (): Promise<() => Promise<void>> => {
  await db().pool.query(
    `CREATE FUNCTION crash_in_the_window() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN RAISE EXCEPTION 'the process died between the commit and its rows'; END $$`,
  );
  await db().pool.query(
    "CREATE TRIGGER crash_in_the_window BEFORE INSERT ON bundle_commit FOR EACH ROW EXECUTE FUNCTION crash_in_the_window()",
  );
  return async () => {
    await db().pool.query("DROP TRIGGER crash_in_the_window ON bundle_commit");
    await db().pool.query("DROP FUNCTION crash_in_the_window()");
  };
};

const inTheWindow = async <T extends { readonly ok: boolean }>(
  act: () => Promise<T>,
): Promise<T> => {
  const close = await openTheWindow();
  try {
    return await act();
  } finally {
    await close();
  }
};

const writeInTheWindow = async (
  scenario: Scenario,
  principal: UserPrincipal,
  input: WriteConceptInput,
): Promise<readonly string[]> => {
  const refused = await inTheWindow(() => writeConcept(principal, doorsOf(scenario), input));
  expect(refused.ok).toBe(false);
  return bundleHistory(scenario.git, scenario.workspaceId);
};

const reconciled = async (scenario: Scenario): Promise<Reconciled> => {
  const result = await reconcile(RECONCILER, doorsOf(scenario), {
    workspaceId: scenario.workspaceId,
  });
  if (!result.ok) throw new Error(`the reconciler refused: ${String(result.error)}`);
  return result.value;
};

const recordedChain = async (
  workspaceId: string,
): Promise<readonly (readonly [string, string | null])[]> => {
  const rows = await db().pool.query<{ sha: string; parent_sha: string | null }>(
    "SELECT sha, parent_sha FROM bundle_commit WHERE workspace_id = $1 ORDER BY committed_at, sha",
    [workspaceId],
  );
  return rows.rows.map((row) => [row.sha, row.parent_sha] as const);
};

const bothReplayedInOrder = async (
  scenario: Scenario,
  behind: Result<unknown, unknown>,
): Promise<readonly string[]> => {
  expect(behind.ok === false && behind.error instanceof Error).toBe(true);
  const history = await bundleHistory(scenario.git, scenario.workspaceId);
  expect(history).toHaveLength(2);
  expect(await recordedChain(scenario.workspaceId)).toEqual([]);

  const run = await reconciled(scenario);

  expect(run).toMatchObject({
    watermark: null,
    replayed: history,
    skipped: [],
    stopped: undefined,
  });
  expect(await recordedChain(scenario.workspaceId)).toEqual([
    [history[0], null],
    [history[1], history[0]],
  ]);
  return history;
};

const rowsOf = async (workspaceId: string) => {
  const read = await db().pool.query<{ kind: string; key: string; value: string }>(
    `SELECT 'identity' AS kind, iri AS key, merge_key AS value
       FROM concept_identity WHERE workspace_id = $1
     UNION ALL
     SELECT 'concept', iri, concat_ws(' ', content_hash, commit_sha, status, sensitivity, path)
       FROM concept_index WHERE workspace_id = $1
     UNION ALL
     SELECT 'commit', sha, concat_ws(' ', parent_sha, audit_event_id, actor)
       FROM bundle_commit WHERE workspace_id = $1
     UNION ALL
     SELECT 'event', id, concat_ws(' ', act, actor, subject_id, detail::text)
       FROM audit_event WHERE workspace_id = $1
     UNION ALL
     SELECT 'node', uid, concat_ws(' ', kind, gen::text) FROM graph_node WHERE workspace_id = $1
     UNION ALL
     SELECT 'edge', uid, concat_ws(' ', from_uid, to_uid) FROM graph_edge WHERE workspace_id = $1
     UNION ALL
     SELECT 'suggestion', id, concat_ws(' ', status, decider, target_iri)
       FROM suggestion WHERE workspace_id = $1
     ORDER BY 1, 2`,
    [workspaceId],
  );
  return read.rows;
};

// The flag the replay act declares as optional, read as such.
const replayDetail = z.object({ evidenceAgrees: z.boolean().optional() });

const replayedEvents = async (workspaceId: string) => {
  const found = await db().pool.query<Record<string, unknown>>(
    "SELECT id, actor, subject_id, subject_kind, batch_id, detail FROM audit_event WHERE workspace_id = $1 AND act = 'platform.reconciler.replayed' ORDER BY id",
    [workspaceId],
  );
  return found.rows;
};

const iriOfFile = async (scenario: Scenario, sha: string, path: string): Promise<string> => {
  const parsed = parseConceptFile(
    await fileAtCommit(scenario.git, scenario.workspaceId, sha, path),
  );
  if (!parsed.ok) throw new Error("the file at the commit is not a concept file");
  const iri = parsed.value.frontmatter["iri"];
  if (typeof iri !== "string") throw new Error("the file carries no IRI");
  return iri;
};

const conceptRow = async (workspaceId: string, iri: string) => {
  const found = await db().pool.query<Record<string, unknown>>(
    `SELECT c.path, c.kind, c.title, c.content_hash, c.commit_sha, c.status, c.sensitivity,
            c.audience, i.merge_key
       FROM concept_index c
       JOIN concept_identity i ON i.workspace_id = c.workspace_id AND i.iri = c.iri
      WHERE c.workspace_id = $1 AND c.iri = $2`,
    [workspaceId, iri],
  );
  return found.rows[0];
};

const sensitivitiesOf = async (workspaceId: string, iris: readonly string[]) => {
  const rows = await Promise.all(iris.map((iri) => conceptRow(workspaceId, iri)));
  return rows.map((row) => row?.["sensitivity"]);
};

const handbook = { resource: "/sources/handbook.pdf", locator: "p.1" };
const minutes = { resource: "/sources/board-minutes.pdf", locator: "p.2" };

const decisionOf = async (suggestionId: string) => {
  const found = await db().pool.query<Record<string, unknown>>(
    "SELECT status, decider, reason, target_iri FROM suggestion WHERE id = $1",
    [suggestionId],
  );
  return found.rows[0];
};

describe("a commit whose rows were lost", () => {
  it("is replayed through the live handler, and the rows catch up with the bundle", async () => {
    const scenario = await arrange();
    const input = guideline("Travel");
    const history = await writeInTheWindow(scenario, scenario.editor, input);

    expect(history).toHaveLength(1);
    expect(await recordedChain(scenario.workspaceId)).toEqual([]);
    const sha = history[0] ?? "";
    const facts = await commitFacts(scenario.git, scenario.workspaceId, sha);

    const run = await reconciled(scenario);

    expect(run).toEqual({
      workspaceId: scenario.workspaceId,
      head: sha,
      watermark: null,
      replayed: [sha],
      skipped: [],
      stopped: undefined,
    });

    expect(await recordedChain(scenario.workspaceId)).toEqual([[sha, null]]);
    const iri = await iriOfFile(scenario, sha, input.path);
    expect(await conceptRow(scenario.workspaceId, iri)).toEqual({
      path: input.path,
      kind: "Guideline",
      title: "Travel",
      content_hash: contentHashOf(input.frontmatter, input.body, input.path),
      commit_sha: sha,

      status: "stable",

      sensitivity: "Restricted",
      audience: "everyone",

      merge_key: "Guideline:travel",
    });
    const commitRow = await db().pool.query<Record<string, unknown>>(
      "SELECT parent_sha, audit_event_id, actor FROM bundle_commit WHERE workspace_id = $1 AND sha = $2",
      [scenario.workspaceId, sha],
    );
    expect(commitRow.rows).toEqual([
      { parent_sha: null, audit_event_id: facts.trailers["Audit"], actor: facts.trailers["Actor"] },
    ]);
    const nodes = await db().pool.query<{ uid: string }>(
      "SELECT uid FROM graph_node WHERE workspace_id = $1",
      [scenario.workspaceId],
    );
    expect(nodes.rows).toEqual([{ uid: iri }]);
  });

  it("is the platform's act on the ledger, while the commit and its row stay the person's", async () => {
    const scenario = await arrange();
    const history = await writeInTheWindow(scenario, scenario.editor, guideline("Leave"));
    const sha = history[0] ?? "";

    await reconciled(scenario);

    const facts = await commitFacts(scenario.git, scenario.workspaceId, sha);
    expect(facts.author).toBe("Grace Editor <grace@acme.invalid>");
    expect(facts.trailers["Actor"]).toBe(actorIdOf(scenario.editor));
    const iri = await iriOfFile(scenario, sha, "knowledge/guidelines/leave-2.md");
    expect(await replayedEvents(scenario.workspaceId)).toEqual([
      {
        id: facts.trailers["Audit"],
        actor: "process:better-answers-reconciler",
        subject_id: sha,
        subject_kind: "reconciler",
        batch_id: null,
        detail: {
          iri,
          commitSha: sha,
          contentHash: contentHashOf(
            { title: "Leave", type: "Guideline", tags: ["finance", "travel"] },
            "# Leave\n\nBook through the platform, and claim within a month.",
            "knowledge/guidelines/leave-2.md",
          ),

          evidenceAgrees: true,
        },
      },
    ]);
    const joined = await db().pool.query<{ act: string; actor: string }>(
      `SELECT e.act, e.actor FROM bundle_commit c
         JOIN audit_event e ON e.workspace_id = c.workspace_id AND e.id = c.audit_event_id
        WHERE c.workspace_id = $1 AND c.sha = $2`,
      [scenario.workspaceId, sha],
    );
    expect(joined.rows).toEqual([
      { act: "platform.reconciler.replayed", actor: "process:better-answers-reconciler" },
    ]);
    const booked = await db().pool.query(
      "SELECT 1 FROM audit_event WHERE workspace_id = $1 AND actor = $2 AND act LIKE 'knowledge.%'",
      [scenario.workspaceId, actorIdOf(scenario.editor)],
    );
    expect(booked.rowCount).toBe(0);
  });

  it("is replayed in order, oldest first, with the writes made on the unrecorded head behind it", async () => {
    const scenario = await arrange();
    const [orphan = null] = await writeInTheWindow(
      scenario,
      scenario.editor,
      guideline("Sickness"),
    );

    const behind = await writeConcept(
      scenario.editor,
      doorsOf(scenario),
      guideline("Overtime", { expects: { head: orphan } }),
    );

    const history = await bothReplayedInOrder(scenario, behind);

    const events = await replayedEvents(scenario.workspaceId);
    expect(events.map((event) => event["subject_id"])).toEqual(history);
    expect(new Set(events.map((event) => event["batch_id"])).size).toBe(1);
    expect(events[0]?.["batch_id"]).not.toBeNull();
  });

  it("changes nothing on a second run, and skips a commit whose trailer id already has its rows whatever the watermark says", async () => {
    const scenario = await arrange();
    const first = await landed(scenario, scenario.editor, guideline("Expenses"));
    const history = await writeInTheWindow(
      scenario,
      scenario.editor,
      guideline("Mileage", { expects: { head: first.sha } }),
    );
    const orphan = history[1] ?? "";
    await reconciled(scenario);
    const before = await rowsOf(scenario.workspaceId);

    const again = await reconciled(scenario);

    expect(again).toMatchObject({ watermark: orphan, replayed: [], skipped: [] });
    expect(await rowsOf(scenario.workspaceId)).toEqual(before);

    await db().pool.query(
      "UPDATE bundle_commit SET committed_at = committed_at - interval '1 day' WHERE workspace_id = $1 AND sha = $2",
      [scenario.workspaceId, orphan],
    );
    const misled = await reconciled(scenario);

    expect(misled).toMatchObject({ watermark: first.sha, replayed: [], skipped: [orphan] });
    expect(await rowsOf(scenario.workspaceId)).toEqual(before);
  });
});

describe("a commit whose rows were lost, carrying what the replay has to read off it", () => {
  it("is replayed from a creation whose caller gave the file no title, because the act writes the title into the file it commits", async () => {
    const scenario = await arrange();
    const input = guideline("Parking", { frontmatter: { type: "Guideline" } });
    const [sha = ""] = await writeInTheWindow(scenario, scenario.editor, input);

    const run = await reconciled(scenario);

    expect(run.stopped).toBeUndefined();
    expect(run.replayed).toEqual([sha]);
    const iri = await iriOfFile(scenario, sha, input.path);
    expect(await conceptRow(scenario.workspaceId, iri)).toMatchObject({
      title: "Parking",
      kind: "Guideline",
      merge_key: "Guideline:parking",
    });
  });

  it("is replayed from a file whose name is not ASCII, which a line-shaped listing from git would have quoted", async () => {
    const scenario = await arrange();
    const input = guideline("Café", { path: "knowledge/guidelines/café.md" });
    const [sha = ""] = await writeInTheWindow(scenario, scenario.editor, input);

    const run = await reconciled(scenario);

    expect(run.stopped).toBeUndefined();
    const iri = await iriOfFile(scenario, sha, input.path);
    expect(await conceptRow(scenario.workspaceId, iri)).toMatchObject({
      path: "knowledge/guidelines/café.md",
      commit_sha: sha,
    });
  });
});

describe("a manifest commit whose rows were lost", () => {
  const manifest = {
    id: "01J6BBBBBBBBBBBBBBBBBBBBBB",
    origin: "company",
    ref: "Four bid libraries, reviewed 22 September 2026",
    owner: "Acme",
    content_version: "2026-09-22",
  } as const;

  it("is replayed as its commit row alone, the platform's act naming the bundle, and the concept written on it follows in order", async () => {
    const scenario = await arrange();
    const lost = await inTheWindow(() =>
      writeManifest(scenario.editor, doorsOf(scenario), {
        manifest,
        message: "Write the bundle's manifest",
        author: { name: "Grace Editor", email: "grace@acme.invalid" },
      }),
    );
    expect(lost.ok).toBe(false);
    const [first = ""] = await bundleHistory(scenario.git, scenario.workspaceId);
    const input = guideline("Travel", { expects: { head: first } });
    const behind = await writeConcept(scenario.editor, doorsOf(scenario), input);

    const history = await bothReplayedInOrder(scenario, behind);

    const facts = await commitFacts(scenario.git, scenario.workspaceId, first);
    const events = await replayedEvents(scenario.workspaceId);
    expect(events[0]).toEqual({
      id: facts.trailers["Audit"],
      actor: "process:better-answers-reconciler",
      subject_id: first,
      subject_kind: "reconciler",
      batch_id: events[1]?.["batch_id"],
      detail: { commitSha: first, bundleId: "01J6BBBBBBBBBBBBBBBBBBBBBB" },
    });
    const concepts = await db().pool.query<{ path: string; commit_sha: string }>(
      "SELECT path, commit_sha FROM concept_index WHERE workspace_id = $1",
      [scenario.workspaceId],
    );
    expect(concepts.rows).toEqual([{ path: input.path, commit_sha: history[1] }]);
  });

  it("stops at a manifest commit whose file does not parse — one the governed write never made — reported, with nothing landed", async () => {
    const scenario = await arrange();
    const forged = await commit(scenario.editor, scenario.git, {
      path: "knowledge/manifest.yaml",
      content: '"id": "acme-2026"\n"origin": "company"\n',
      message: "Write a manifest by hand",
      author: { name: "Grace Editor", email: "grace@acme.invalid" },
      trailers: { actor: actorIdOf(scenario.editor), audit: ulid() },
      expectedHead: null,
      at: new Date(),
    });
    if (!forged.ok) throw new Error(`the forged commit was refused: ${String(forged.error)}`);

    const run = await reconciled(scenario);

    expect(run).toMatchObject({
      replayed: [],
      skipped: [],
      stopped: { sha: forged.value.sha, reason: "unreadable-commit" },
    });
    expect(await recordedChain(scenario.workspaceId)).toEqual([]);
    expect(await replayedEvents(scenario.workspaceId)).toEqual([]);
  });
});

describe("a re-write whose rows were lost", () => {
  it("keeps the concept's identity, class and status, and lands the new content at the commit, while the file's sources and the standing citations agree", async () => {
    const scenario = await arrange();
    const input = guideline("Parking");
    const first = await landed(scenario, scenario.editor, input);
    const body = "# Parking\n\nClaim the station car park, and nothing else.";
    const history = await writeInTheWindow(scenario, scenario.editor, {
      ...input,
      iri: first.iri,
      body,
      expects: { head: first.sha },
    });

    const run = await reconciled(scenario);

    expect(run).toMatchObject({ watermark: first.sha, replayed: [history[1]] });

    expect(await conceptRow(scenario.workspaceId, first.iri)).toEqual({
      path: input.path,
      kind: "Guideline",
      title: "Parking",
      content_hash: contentHashOf(input.frontmatter, body, input.path),
      commit_sha: history[1],
      status: "stable",
      sensitivity: "Internal",
      audience: "everyone",
      merge_key: input.mergeKey,
    });
    const counted = await db().pool.query<{ concepts: string; identities: string }>(
      `SELECT (SELECT count(*) FROM concept_index WHERE workspace_id = $1)::text AS concepts,
              (SELECT count(*) FROM concept_identity WHERE workspace_id = $1)::text AS identities`,
      [scenario.workspaceId],
    );
    expect(counted.rows).toEqual([{ concepts: "1", identities: "1" }]);
  });

  it("lands Restricted, and says so on the ledger, when the file's sources are not the standing citations — a lost commit that added a citation never replays at the class the citations it lost derived", async () => {
    const scenario = await arrange();
    const internal = await bindingHolding(db(), scenario.workspaceId);
    const restricted = await bindingHolding(db(), scenario.workspaceId, {
      sensitivity: "Restricted",
    });
    const input = guideline("Allowances", {
      frontmatter: { title: "Allowances", type: "Guideline", sources: [handbook] },
      evidence: [{ sourceDocumentId: internal.documentId, ...handbook }],
    });
    const first = await landed(scenario, scenario.editor, input);
    expect(await conceptRow(scenario.workspaceId, first.iri)).toMatchObject({
      sensitivity: "Internal",
    });

    const [, unchanged = null] = await writeInTheWindow(scenario, scenario.editor, {
      ...input,
      iri: first.iri,
      body: "# Allowances\n\nThe same sources, other words.",
      expects: { head: first.sha },
    });
    const history = await writeInTheWindow(scenario, scenario.editor, {
      ...input,
      iri: first.iri,
      frontmatter: { title: "Allowances", type: "Guideline", sources: [handbook, minutes] },
      evidence: [
        { sourceDocumentId: internal.documentId, ...handbook },
        { sourceDocumentId: restricted.documentId, ...minutes },
      ],
      body: "# Allowances\n\nWhat the board minuted.",
      expects: { head: unchanged },
    });

    const run = await reconciled(scenario);

    expect(run).toMatchObject({ replayed: history.slice(1), stopped: undefined });
    expect(await conceptRow(scenario.workspaceId, first.iri)).toMatchObject({
      commit_sha: history[2],
      sensitivity: "Restricted",
      audience: "everyone",
    });
    const events = await replayedEvents(scenario.workspaceId);
    expect(events.map((event) => event["subject_id"])).toEqual(history.slice(1));
    expect(events.map((event) => replayDetail.parse(event["detail"]).evidenceAgrees)).toEqual([
      true,
      false,
    ]);
  });

  it("stays Restricted through the cascade of a publish and of a narrowing when the file's sources are not the standing citations, while a concept beside it moves with the binding", async () => {
    const scenario = await arrange();
    const website = await bindingHolding(db(), scenario.workspaceId, {
      sensitivity: "Public",
      publishedAt: null,
    });
    const restricted = await bindingHolding(db(), scenario.workspaceId, {
      sensitivity: "Restricted",
    });
    const citingTheWebsite = (title: string) =>
      guideline(title, {
        frontmatter: { title, type: "Guideline", sources: [handbook] },
        evidence: [{ sourceDocumentId: website.documentId, ...handbook }],
        sensitivity: "Restricted",
      });
    const input = citingTheWebsite("Allowances");
    const first = await landed(scenario, scenario.admin, input);
    const beside = await landed(scenario, scenario.admin, {
      ...citingTheWebsite("Mileage"),
      expects: { head: first.sha },
    });
    await writeInTheWindow(scenario, scenario.admin, {
      ...input,
      iri: first.iri,
      frontmatter: { title: "Allowances", type: "Guideline", sources: [handbook, minutes] },
      evidence: [
        { sourceDocumentId: website.documentId, ...handbook },
        { sourceDocumentId: restricted.documentId, ...minutes },
      ],
      body: "# Allowances\n\nWhat the board minuted.",
      expects: { head: beside.sha },
    });
    expect(await reconciled(scenario)).toMatchObject({ stopped: undefined });
    expect(
      (await replayedEvents(scenario.workspaceId)).map(
        (event) => replayDetail.parse(event["detail"]).evidenceAgrees,
      ),
    ).toEqual([false]);

    const published = await publishedOnceIndexed(db(), scenario.admin, website.bindingId);

    expect(published.ok).toBe(true);
    expect(await sensitivitiesOf(scenario.workspaceId, [first.iri, beside.iri])).toEqual([
      "Restricted",
      "Public",
    ]);

    const narrowed = await readingAs(db().runtimePool, scenario.admin, (admin, tx) =>
      narrowBinding(
        admin,
        tx,
        inputOf(narrowBindingInput, {
          bindingId: website.bindingId,
          sensitivity: "Internal",
          audience: "everyone",
        }),
      ),
    );

    expect(narrowed.ok).toBe(true);
    expect(await sensitivitiesOf(scenario.workspaceId, [first.iri, beside.iri])).toEqual([
      "Restricted",
      "Internal",
    ]);
  });

  it("is replayed even once its author may no longer read the concept, because the replay is the platform's and never a second judgement", async () => {
    const scenario = await arrange();
    const binding = await bindingHolding(db(), scenario.workspaceId);
    const cited = [{ sourceDocumentId: binding.documentId, locator: "p.1", resource: "Handbook" }];
    const input = guideline("Hospitality", { evidence: cited });
    const first = await landed(scenario, scenario.editor, input);
    const body = "# Hospitality\n\nA meal a day, receipted.";
    const history = await writeInTheWindow(scenario, scenario.editor, {
      ...input,
      iri: first.iri,
      body,
      expects: { head: first.sha },
    });

    const narrowed = await readingAs(db().runtimePool, scenario.admin, (admin, tx) =>
      narrowBinding(
        admin,
        tx,
        inputOf(narrowBindingInput, {
          bindingId: binding.bindingId,
          sensitivity: "Restricted",
          audience: "everyone",
        }),
      ),
    );
    expect(narrowed.ok).toBe(true);

    const run = await reconciled(scenario);

    expect(run).toMatchObject({ replayed: [history[1]], stopped: undefined });
    expect(await conceptRow(scenario.workspaceId, first.iri)).toMatchObject({
      content_hash: contentHashOf(input.frontmatter, body, input.path),
      commit_sha: history[1],
      sensitivity: "Restricted",
    });
  });
});

let proposed = 0;

const requestFor = (
  title: string,
  overrides: Partial<SuggestionRequest> = {},
): SuggestionRequest => {
  proposed += 1;
  return {
    mergeKey: `guideline:proposed-${proposed}`,
    path: `knowledge/guidelines/proposed-${proposed}.md`,
    conceptKind: "Guideline",
    title,
    frontmatter: { title, type: "Guideline" },
    body: `# ${title}\n\nProposed by a colleague, decided by an Admin.`,
    ...overrides,
  };
};

const raised = async (scenario: Scenario, request: SuggestionRequest) => {
  const set = await submitSuggestionSet(
    scenario.editor,
    { postgres: scenario.postgres },
    { kind: "edit", requests: [request] },
  );
  if (!set.ok) throw new Error(`the set was not submitted: ${String(set.error)}`);
  const summary = await readingAs(db().runtimePool, scenario.admin, (principal, tx) =>
    suggestionSetSummary(principal, tx, set.value.setId),
  );
  if (!summary.ok) throw new Error(`the set did not render: ${String(summary.error)}`);
  const item = summary.value[0];
  if (item === undefined) throw new Error("the set rendered no item");
  return { suggestionId: item.suggestionId, target: item.target };
};

const acceptInTheWindow = async (
  scenario: Scenario,
  item: { readonly suggestionId: string; readonly target: string | null },
): Promise<string> => {
  const outcomes = await inTheWindow(() =>
    acceptSuggestions(scenario.admin, doorsOf(scenario), {
      decisions: [{ suggestionId: item.suggestionId, expectedTarget: item.target }],
    }),
  );
  expect(outcomes.ok && outcomes.value.map((outcome) => outcome.outcome.ok)).toEqual([false]);

  const history = await bundleHistory(scenario.git, scenario.workspaceId);
  const sha = history.at(-1) ?? "";
  const facts = await commitFacts(scenario.git, scenario.workspaceId, sha);
  expect(facts.trailers["Suggestion"]).toBe(item.suggestionId);
  expect(await decisionOf(item.suggestionId)).toMatchObject({ status: "waiting" });
  return sha;
};

describe("an acceptance whose rows were lost", () => {
  it("is replayed: the concept lands, and the suggestion is decided by the Admin who accepted it", async () => {
    const scenario = await arrange();
    const request = requestFor("Remote working");
    const item = await raised(scenario, request);
    const sha = await acceptInTheWindow(scenario, item);

    const run = await reconciled(scenario);

    expect(run).toMatchObject({ replayed: [sha], stopped: undefined });

    const iri = await iriOfFile(scenario, sha, request.path);
    expect(await decisionOf(item.suggestionId)).toEqual({
      status: "accepted",
      decider: actorIdOf(scenario.admin),
      reason: null,
      target_iri: iri,
    });
    expect(await conceptRow(scenario.workspaceId, iri)).toMatchObject({
      path: request.path,
      kind: "Guideline",
      title: "Remote working",
      merge_key: request.mergeKey,
      content_hash: contentHashOf(request.frontmatter, request.body, request.path),
    });

    expect(await replayedEvents(scenario.workspaceId)).toHaveLength(1);
    const accepted = await db().pool.query(
      "SELECT 1 FROM audit_event WHERE workspace_id = $1 AND act = 'knowledge.suggestion.accepted'",
      [scenario.workspaceId],
    );
    expect(accepted.rowCount).toBe(0);
  });

  it("lands one whose suggestion was declined in the meantime as the commit it is, and leaves the decision where it was", async () => {
    const scenario = await arrange();
    const request = requestFor("Hot desking");
    const item = await raised(scenario, request);
    const sha = await acceptInTheWindow(scenario, item);

    const declined = await declineSuggestion(scenario.admin, doorsOf(scenario), {
      suggestionId: item.suggestionId,
      reason: "decided again after the outage",
    });
    expect(declined.ok).toBe(true);

    const run = await reconciled(scenario);

    expect(run).toMatchObject({ replayed: [sha], stopped: undefined });
    expect(await decisionOf(item.suggestionId)).toMatchObject({
      status: "declined",
      reason: "decided again after the outage",
      target_iri: null,
    });
    const iri = await iriOfFile(scenario, sha, request.path);
    expect(await conceptRow(scenario.workspaceId, iri)).toMatchObject({
      title: "Hot desking",

      merge_key: "Guideline:hot desking",
    });
  });
});

describe("what the reconciler refuses", () => {
  it("refuses a bundle whose recorded history is not a prefix of its own, and lands nothing", async () => {
    const scenario = await arrange();
    await landed(scenario, scenario.editor, guideline("Uniform"));
    const before = await rowsOf(scenario.workspaceId);
    await divergeHistory(scenario.git, scenario.workspaceId);

    const refused = await reconcile(RECONCILER, doorsOf(scenario), {
      workspaceId: scenario.workspaceId,
    });

    expect(refused).toEqual({ ok: false, error: "history-diverged" });
    expect(await rowsOf(scenario.workspaceId)).toEqual(before);
  });

  it("refuses a workspace with no repository, which on a restore is a store that was not restored", async () => {
    const scenario = await arrange();
    await removeRepository(scenario.git, scenario.workspaceId);

    const refused = await reconcile(RECONCILER, doorsOf(scenario), {
      workspaceId: scenario.workspaceId,
    });

    expect(refused).toEqual({ ok: false, error: "no-such-repository" });
  });

  it("refuses a workspace id of no known form before it opens anything", async () => {
    const scenario = await arrange();

    const refused = await reconcile(RECONCILER, doorsOf(scenario), { workspaceId: "acme" });

    expect(refused).toEqual({ ok: false, error: "malformed" });
  });

  it("finds nothing to do for a bundle with no commits, and for one whose rows are up to date", async () => {
    const scenario = await arrange();

    const empty = await reconciled(scenario);
    const first = await landed(scenario, scenario.editor, guideline("Bicycles"));
    const current = await reconciled(scenario);

    expect(empty).toMatchObject({ head: null, watermark: null, replayed: [], skipped: [] });
    expect(current).toMatchObject({
      head: first.sha,
      watermark: first.sha,
      replayed: [],
      skipped: [],
    });
  });
});

describe("a commit the rows cannot take", () => {
  it("stops the replay there with its ledger row rolled back, and lands nothing behind it", async () => {
    const scenario = await arrange();
    const first = guideline("Fuel");
    const written = await landed(scenario, scenario.editor, first);

    const clash = await commit(scenario.editor, scenario.git, {
      path: first.path,
      content: renderConceptFile(
        { title: "Fuel again", type: "Guideline", iri: conceptIriOf(ulid()) },
        first.body,
      ),
      message: "Record a second fuel guideline by hand",
      author: first.author,
      trailers: { actor: actorIdOf(scenario.editor), audit: ulid() },
      expectedHead: written.sha,
      at: new Date(),
    });
    expect(clash.ok).toBe(true);
    const orphan = clash.ok ? clash.value.sha : null;

    const behind = await writeConcept(
      scenario.editor,
      doorsOf(scenario),
      guideline("Tolls", { expects: { head: orphan } }),
    );
    expect(behind.ok).toBe(false);
    const history = await bundleHistory(scenario.git, scenario.workspaceId);
    expect(history).toHaveLength(3);
    const before = await rowsOf(scenario.workspaceId);

    const run = await reconciled(scenario);

    expect(run).toEqual({
      workspaceId: scenario.workspaceId,
      head: history[2],
      watermark: written.sha,
      replayed: [],
      skipped: [],
      stopped: { sha: history[1], reason: "path-taken" },
    });
    expect(await rowsOf(scenario.workspaceId)).toEqual(before);
    expect(await replayedEvents(scenario.workspaceId)).toEqual([]);
  });

  it("stops at a commit that moves a concept to another path, as the live handler refuses a rename, and leaves the row where it was", async () => {
    const scenario = await arrange();
    const input = guideline("Bridges");
    const written = await landed(scenario, scenario.editor, input);

    const moved = await commit(scenario.editor, scenario.git, {
      path: "knowledge/guidelines/bridges-moved.md",
      content: await fileAtCommit(scenario.git, scenario.workspaceId, written.sha, input.path),
      message: "Move the bridges guideline by hand",
      author: { name: "Grace Editor", email: "grace@acme.invalid" },
      trailers: { actor: actorIdOf(scenario.editor), audit: ulid() },
      expectedHead: written.sha,
      at: new Date(),
    });
    expect(moved.ok).toBe(true);

    const run = await reconciled(scenario);

    expect(run).toMatchObject({
      replayed: [],
      stopped: { sha: moved.ok ? moved.value.sha : "", reason: "rename-refused" },
    });
    expect(await conceptRow(scenario.workspaceId, written.iri)).toMatchObject({
      path: input.path,
      commit_sha: written.sha,
    });
    expect(await recordedChain(scenario.workspaceId)).toEqual([[written.sha, null]]);
  });

  it("stops at a commit the governed write did not make, rather than guessing what it meant", async () => {
    const scenario = await arrange();

    const made = await commit(scenario.editor, scenario.git, {
      path: "knowledge/manifest.yaml",
      content: "name: acme\n",
      message: "Seed the manifest by hand",
      author: { name: "Grace Editor", email: "grace@acme.invalid" },
      trailers: { actor: actorIdOf(scenario.editor), audit: ulid() },
      expectedHead: null,
      at: new Date(),
    });
    expect(made.ok).toBe(true);

    const run = await reconciled(scenario);

    expect(run.stopped).toEqual({
      sha: made.ok ? made.value.sha : "",
      reason: "unreadable-commit",
    });
    expect(await recordedChain(scenario.workspaceId)).toEqual([]);
  });
});

describe("the fence", () => {
  it("waits behind a live act on the same bundle, so a replay and a write are one after the other", async () => {
    const scenario = await arrange();
    const order: string[] = [];
    const act = withRepositoryLock(scenario.editor, scenario.git, async () => {
      order.push("act in");
      await new Promise((resolve) => setTimeout(resolve, 30));
      order.push("act out");
    });
    const run = reconcile(RECONCILER, doorsOf(scenario), {
      workspaceId: scenario.workspaceId,
    }).then(() => order.push("reconciler out"));

    await Promise.all([act, run]);

    expect(order).toEqual(["act in", "act out", "reconciler out"]);
  });
});

const PERIODIC_HEAD_CHECK_ALLOWANCE_MS = 90_000;

describe("the periodic head check's pass", () => {
  it(
    "reconciles every workspace, each on its own outcome",
    async () => {
      const behind = await arrange();
      const current = await arrange();
      const missing = await arrange();
      await removeRepository(missing.git, missing.workspaceId);
      const history = await writeInTheWindow(behind, behind.editor, guideline("Lunch"));

      const pass = await reconcileEveryWorkspace(RECONCILER, doorsOf(behind));

      expect(pass.ok).toBe(true);
      if (!pass.ok) return;
      const outcomes = new Map(pass.value.map((outcome) => [outcome.workspaceId, outcome.outcome]));
      expect(outcomes.get(behind.workspaceId)).toMatchObject({
        ok: true,
        value: { replayed: history },
      });
      expect(outcomes.get(current.workspaceId)).toMatchObject({
        ok: true,
        value: { head: null, replayed: [] },
      });

      expect(outcomes.get(missing.workspaceId)).toEqual({ ok: false, error: "no-such-repository" });
    },
    PERIODIC_HEAD_CHECK_ALLOWANCE_MS,
  );
});

describe("reconciler hits", () => {
  it("are a query over the ledger rows the replay wrote — oldest first, from an instant when one is named — and never a counter", async () => {
    const scenario = await arrange();
    const [first = ""] = await writeInTheWindow(scenario, scenario.editor, guideline("Bikes"));
    const history = await writeInTheWindow(
      scenario,
      scenario.editor,
      guideline("Trains", { expects: { head: first } }),
    );

    expect(await reconcilerHits(RECONCILER, scenario.postgres, scenario)).toEqual({
      ok: true,
      value: [],
    });

    await reconciled(scenario);

    const hits = await reconcilerHits(RECONCILER, scenario.postgres, scenario);
    expect(hits.ok).toBe(true);
    if (!hits.ok) return;

    expect(hits.value.map((hit) => hit.commitSha)).toEqual(history);
    const facts = await commitFacts(scenario.git, scenario.workspaceId, first);
    expect(hits.value[0]?.auditEventId).toBe(facts.trailers["Audit"]);
    expect(hits.value[0]?.batchId).not.toBeNull();
    expect(hits.value[1]?.batchId).toBe(hits.value[0]?.batchId);

    const later = new Date(Date.now() + 60_000);
    expect(
      await reconcilerHits(RECONCILER, scenario.postgres, { ...scenario, since: later }),
    ).toEqual({ ok: true, value: [] });
    expect(await reconcilerHits(RECONCILER, scenario.postgres, { workspaceId: "nope" })).toEqual({
      ok: false,
      error: "malformed",
    });
  });
});

describe("a concept file read back", () => {
  it("reads back exactly what the renderer wrote, in every shape the frontmatter takes", () => {
    const frontmatter: Frontmatter = {
      title: 'Say "hello": a title',
      type: "Policy",
      count: 3,
      ratio: 0.5,
      live: true,
      gone: null,
      tags: ["a: b", "  - c"],
      none: [],
      sources: [
        { resource: "/sources/handbook.pdf", title: "Handbook", locator: "p.4" },
        { resource: "https://x.test/y", locator: null, pages: 2, checked: false },
      ],
      "odd: key": "value",
    };
    const body = "# Heading\n\nA line.  \r\nAnother.\n\n\n";

    const read = parseConceptFile(renderConceptFile(frontmatter, body));

    expect(read).toEqual({
      ok: true,
      value: { frontmatter, body: "# Heading\n\nA line.\nAnother.\n" },
    });
    expect(read.ok && contentHashOf(read.value.frontmatter, read.value.body, "k/a.md")).toBe(
      contentHashOf(frontmatter, body, "k/a.md"),
    );
  });

  it.each([
    ["no fences at all", "title: bare\n\nbody\n"],
    ["a bare YAML key", '---\ntitle: bare\n"type": "Policy"\n---\n\nbody\n'],
    ["no blank line after the fence", '---\n"title": "x"\n---\nbody\n'],
    ["a list mixing strings and entries", '---\n"tags":\n  - "a"\n  - "k": 1\n---\n\n'],
    ["an object where a scalar goes", '---\n"title": {"a": 1}\n---\n\n'],
    ["an item outside a list", '---\n  - "a"\n---\n\n'],

    ["a key written twice", '---\n"title": "one"\n"title": "two"\n---\n\n'],

    ["a key with no value and no items beneath it", '---\n"tags":\n"title": "x"\n---\n\n'],
    ["a bare key at the end of the frontmatter", '---\n"title": "x"\n"tags":\n---\n\n'],
  ])("refuses what the renderer never wrote — %s", (_shape, file) => {
    expect(parseConceptFile(file)).toEqual({ ok: false, error: "malformed" });
  });
});
