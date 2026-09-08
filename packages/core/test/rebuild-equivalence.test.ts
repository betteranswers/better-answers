import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { conceptIriOf, ulid } from "@better-answers/schema";

import { head } from "@better-answers/core/store/git";

import {
  acceptSuggestions,
  submitSuggestionSet,
  writeConcept,
  type ConceptWritten,
  type SuggestionRequest,
  type WriteConceptInput,
} from "../src/concepts/index.ts";
import type { UserPrincipal } from "../src/kernel/index.ts";
import { enqueueJob } from "../src/runs/index.ts";
import { narrowBinding } from "../src/sources/index.ts";
import { readingAs } from "./suite-postgres.ts";
import { bindingHolding, groupNamed } from "./sourced-concept.ts";
import { doorsOf, suiteWithBundles, type Scenario } from "./workspace-with-bundle.ts";

/**
 * **Rebuild-equivalence, cross-tier and live** — the one enforceable meaning of *derived,
 * never a source of truth* (ADR 0011, ADR 0023's amendment).
 *
 * The app's own acts build a map: concepts written through the governed write, one landed
 * by an acceptance, one narrowed by a binding's own act. Then the **worker runs as a real
 * process** — `uv run --frozen better-answers-worker --once`, against this database and
 * this bundle root — and rebuilds the whole thing as the next generation. The two are then
 * compared row for row, column for column, `gen` aside.
 *
 * **No fixture stands between the tiers.** What the app wrote is what the worker must
 * reproduce, from the bundle at its head and the records beside it, with a derivation
 * written twice in two languages. That is the whole point: a golden file would let both
 * sides drift together, and the docblock over `LINK_DEFINITION` in the graph door is a
 * contract only because this test fails when either side leaves it.
 *
 * The map is built to reach **every branch of that docblock**: the four link forms and an
 * autolink; a link quoted in a code span and one in a fence; an image; a link to an IRI
 * nobody has written; a path link to a concept that lands afterwards, so the live map only
 * gains that edge through the re-derive; lineage to a deprecated concept of the same kind
 * and to a live one; a heading, so a section is named; and a paragraph of three sentences,
 * so the sentence is cut rather than copied.
 */

const run = promisify(execFile);

const { db, bundles, arrange } = suiteWithBundles();

const workerDirectory = path.resolve(import.meta.dirname, "../../../apps/worker");

/**
 * The worker's own DSN over this test's database: the superuser's connection with the
 * worker's role taken at session start. Both runtime roles are NOLOGIN (migration 0000),
 * so this is how a process takes one — the same trick `migratedPostgresOver` uses for
 * `app_rt`, and the reason it is a startup option is that a connection which cannot take
 * the role is refused by Postgres rather than handed out as the superuser.
 *
 * `WORKER_DATABASE_URL`'s production shape is a DSN that logs in as `worker_rt` directly
 * (`deploy/platform.compose.yaml`), so nothing here assumes the option is present: the
 * worker reads one string out of its environment and connects, whichever of the two it is.
 */
const workerDsn = (): string => {
  const uri = new URL(db().connectionUri);
  // Written into `search` rather than through `searchParams`, which form-encodes a space
  // as `+` — and libpq reads `+` literally, so the option arrives as `+role` and the
  // connection is refused before the worker has done anything wrong.
  uri.search = "options=-c%20role%3Dworker_rt";
  return uri.toString();
};

/**
 * Run the worker once, over every workspace, and fail loudly if it is not runnable.
 *
 * `[CHECK2]`: a suite that can run nothing fails. If `uv` is missing this test says so
 * rather than skipping — a cross-tier fence that quietly stops crossing is worse than no
 * fence, because the suite still reports green.
 */
const runWorkerOnce = async (): Promise<void> => {
  const outcome = await run("uv", ["run", "--frozen", "better-answers-worker", "--once"], {
    cwd: workerDirectory,
    env: {
      ...process.env,
      DATABASE_URL: workerDsn(),
      GIT_STORE_DIR: bundles().root,
      WORKER_ID: "rebuild-equivalence",
    },
  }).catch((cause: unknown) => {
    const failure = cause as { stderr?: string; stdout?: string; message?: string };
    throw new Error(
      `the worker did not run: ${failure.message ?? ""}\n${failure.stderr ?? ""}\n${failure.stdout ?? ""}`,
    );
  });
  // The loop logs JSON to stdout; a failed job is a line, never a non-zero exit, so the
  // outcome rows below are what a failure is read off.
  expect(outcome.stderr).not.toMatch(/Traceback/);
};

let sequence = 0;

/**
 * A concept written through the governed write, against the bundle's current head, and the
 * three facts a later re-write of it has to name: its path, its merge key and its title.
 *
 * Internal rather than the fail-closed default, because a re-write may not reach a concept
 * the read predicate withholds from its writer (T-055) — so a concept an Editor is going
 * to deprecate has to be one an Editor can see.
 */
type WrittenNote = ConceptWritten & {
  readonly path: string;
  readonly mergeKey: string;
  readonly title: string;
};

const wrote = async (
  scenario: Scenario,
  writer: UserPrincipal,
  overrides: Partial<WriteConceptInput> & { readonly body: string },
): Promise<WrittenNote> => {
  sequence += 1;
  const conceptPath = overrides.path ?? `knowledge/note-${sequence}.md`;
  const title = overrides.title ?? `Note ${sequence}`;
  const mergeKey = overrides.mergeKey ?? `note:equivalence-${sequence}`;
  const written = await writeConcept(writer, doorsOf(scenario), {
    kind: "Note",
    frontmatter: { title, type: "Note" },
    message: `Record ${title}`,
    author: { name: "Ada Editor", email: "ada@acme.invalid" },
    expects: { head: await head(writer, scenario.git) },
    status: "stable",
    sensitivity: "Internal",
    ...overrides,
    mergeKey,
    path: conceptPath,
    title,
  });
  if (!written.ok) throw new Error(`the write was refused: ${String(written.error)}`);
  return { ...written.value, path: conceptPath, mergeKey, title };
};

/** One suggestion, submitted by the Editor and accepted by the Admin — the acceptance path. */
const accepted = async (
  scenario: Scenario,
  request: Partial<SuggestionRequest> & { readonly body: string },
): Promise<ConceptWritten> => {
  sequence += 1;
  const set = await submitSuggestionSet(
    scenario.editor,
    { postgres: scenario.postgres },
    {
      kind: "edit",
      requests: [
        {
          frontmatter: { title: `Accepted note ${sequence}`, type: "Note" },
          ...request,
          mergeKey: `note:accepted-${sequence}`,
          path: `knowledge/accepted-${sequence}.md`,
          conceptKind: "Note",
          title: `Accepted note ${sequence}`,
        },
      ],
    },
  );
  if (!set.ok) throw new Error(`the set was not submitted: ${String(set.error)}`);
  const decided = await acceptSuggestions(scenario.admin, doorsOf(scenario), {
    decisions: set.value.suggestionIds.map((suggestionId) => ({
      suggestionId,
      expectedTarget: null,
    })),
  });
  if (!decided.ok) throw new Error(`the acceptance was refused: ${String(decided.error)}`);
  const outcome = decided.value[0]?.outcome;
  if (outcome?.ok !== true) {
    throw new Error(`the acceptance did not land: ${String(outcome?.error)}`);
  }
  return outcome.value;
};

/** Every column of a generation's nodes but the stamp, in the order a comparison reads them. */
const nodesAt = async (workspaceId: string, gen: number) => {
  const rows = await db().pool.query(
    `SELECT uid, label, kind, published_at, sensitivity, audience, audience_groups
       FROM graph_node WHERE workspace_id = $1 AND gen = $2 ORDER BY uid`,
    [workspaceId, gen],
  );
  return rows.rows;
};

/** The same for edges: every column the derivation decides, `gen` aside. */
const edgesAt = async (workspaceId: string, gen: number) => {
  const rows = await db().pool.query(
    `SELECT uid, label, from_uid, to_uid, from_kind, to_kind, section, sentence,
            published_at, sensitivity, audience, audience_groups
       FROM graph_edge WHERE workspace_id = $1 AND gen = $2 ORDER BY uid`,
    [workspaceId, gen],
  );
  return rows.rows;
};

const liveGenerationOf = async (workspaceId: string): Promise<number | undefined> => {
  const rows = await db().pool.query<{ live_gen: number }>(
    "SELECT live_gen FROM graph_generation WHERE workspace_id = $1",
    [workspaceId],
  );
  return rows.rows[0]?.live_gen;
};

/**
 * A map that touches every branch of the derivation rule, built only through the slices'
 * own acts — never a seeded graph row, because a row written past the derivation would
 * prove nothing about it.
 */
const buildTheMap = async (scenario: Scenario) => {
  const binding = await bindingHolding(db(), scenario.workspaceId);
  const group = await groupNamed(db(), scenario, "HR", [scenario.editor]);

  // A cited concept for lineage, deprecated later so its successors' edges relabel.
  const superseded = await wrote(scenario, scenario.editor, {
    body: "The old rule stood until it did not.",
  });
  // A live one, so the other lineage arm has a target too.
  const derivedFrom = await wrote(scenario, scenario.editor, {
    body: "The evidence this rests on.",
  });
  // The concept the citations will point at by path, written *after* the linker below, so
  // the live map gains that edge through the re-derive and not at the linker's own write.
  const laterPath = `knowledge/lands-later-${ulid().toLowerCase()}.md`;
  // An IRI nobody will ever write: the dangling arm.
  const unlanded = conceptIriOf(ulid());

  const linker = await wrote(scenario, scenario.editor, {
    // Every link form, in one body, under a heading and inside a three-sentence paragraph.
    body: [
      "# The map",
      "",
      "## Details",
      "",
      `This is the first sentence. It names [an inline link](${superseded.iri}) and`,
      `[a full reference][full] and [a collapsed one][] and [a shortcut] and an autolink`,
      `<${derivedFrom.iri}> and [one nobody wrote](${unlanded}) and [one landing later](/${laterPath}).`,
      "This is the third sentence.",
      "",
      `A quoted \`[span link](${superseded.iri})\` asserts nothing, and neither does`,
      `![an image](${derivedFrom.iri}).`,
      "",
      "```",
      `[a fenced link](${superseded.iri})`,
      "```",
      "",
      `[full]: ${derivedFrom.iri}`,
      `[a collapsed one]: ${superseded.iri}`,
      `[a shortcut]: ${derivedFrom.iri}`,
    ].join("\n"),
    // Lineage both ways: the concept that will be deprecated, and one that stays live.
    frontmatter: {
      title: "The linker",
      type: "Note",
      sources: [
        { resource: superseded.iri, locator: "p.1" },
        { resource: derivedFrom.iri, locator: "p.2" },
      ],
    },
    // Evidence, so the narrowing below has a concept to cascade to.
    evidence: [{ sourceDocumentId: binding.documentId, locator: "p.1", resource: "The handbook" }],
  });

  // The path target lands now: the live map gains the linker's edge by the re-derive, and
  // the rebuild gains it by simply resolving the path.
  await wrote(scenario, scenario.editor, {
    path: laterPath,
    body: "The concept the link was waiting for.",
  });

  // The acceptance path: a concept that reached the bundle through the inbox, linking to
  // one already there, so an accepted write's delta is in the comparison too.
  await accepted(scenario, {
    body: `Accepted, and it cites [the linker](/${linker.path}) once.`,
  });

  // The deprecation: the inbound lineage relabel is what turns the linker's DERIVED_FROM
  // into SUPERSEDES, with no edit to the linker at all.
  await wrote(scenario, scenario.editor, {
    iri: superseded.iri,
    path: superseded.path,
    mergeKey: superseded.mergeKey,
    title: superseded.title,
    body: "The old rule stood until it did not.",
    status: "deprecated",
  });

  // The narrowing: the binding's own act moves the concept's columns and the map's copies
  // of them, which is what makes `audience_groups` a real column in the comparison.
  const narrowed = await readingAs(db().runtimePool, scenario.admin, (admin, tx) =>
    narrowBinding(admin, tx, {
      bindingId: binding.bindingId,
      sensitivity: "Internal",
      audience: "groups",
      audienceGroups: [group],
    }),
  );
  if (!narrowed.ok) throw new Error(`the narrowing was refused: ${String(narrowed.error)}`);

  return { linker, group };
};

describe("the worker's rebuild against the app's own map", () => {
  it("reproduces the live generation exactly, column by column, from the bundle and the records", async () => {
    const scenario = await arrange();
    const { linker, group } = await buildTheMap(scenario);

    const live = await liveGenerationOf(scenario.workspaceId);
    expect(live, "the app's acts wrote a live generation").toBe(1);
    const liveNodes = await nodesAt(scenario.workspaceId, 1);
    const liveEdges = await edgesAt(scenario.workspaceId, 1);
    // The map is worth comparing: every derivation branch left something behind.
    expect(liveNodes.length).toBeGreaterThan(4);
    expect(liveEdges.length).toBeGreaterThan(6);

    const queued = await enqueueJob(scenario.admin, scenario.postgres, {
      kind: "full-rebuild",
      reason: "drill",
    });
    expect(queued.ok, "the rebuild was queued through the runs slice").toBe(true);
    // A second job, so the same two passes also prove the two parsers agree over the very
    // bundle these acts wrote — which is the nightly audit's whole claim.
    const audit = await enqueueJob(scenario.admin, scenario.postgres, {
      kind: "nightly-audit",
    });
    expect(audit.ok).toBe(true);

    // One pass claims one job per workspace, so two passes run both.
    await runWorkerOnce();
    await runWorkerOnce();

    expect(await liveGenerationOf(scenario.workspaceId)).toBe(2);
    expect(await nodesAt(scenario.workspaceId, 2)).toEqual(liveNodes);
    expect(await edgesAt(scenario.workspaceId, 2)).toEqual(liveEdges);

    // And the branches are there to be compared: the audience the narrowing moved, the
    // section a heading named, the sentence a paragraph was cut to, and both lineage
    // labels — so a rebuild that reproduced an empty map could not pass this.
    const linkerEdges = liveEdges.filter((edge) => edge["from_uid"] === linker.iri);
    // Seven links resolve — inline, full, collapsed, shortcut, autolink, the dangling IRI
    // and the path that landed afterwards — and the two lineage citations wear one label
    // each, the deprecated same-kind concept's having been relabelled by its own
    // deprecation and not by any edit to this file.
    expect(linkerEdges.map((edge) => edge["label"]).toSorted()).toEqual([
      "DERIVED_FROM",
      ...Array.from({ length: 7 }, () => "LINKS_TO"),
      "SUPERSEDES",
    ]);
    const linked = linkerEdges.find((edge) => edge["label"] === "LINKS_TO");
    expect(linked?.["section"]).toBe("Details");
    expect(linked?.["sentence"]).toMatch(/^It names an inline link and/u);
    expect(linked?.["audience_groups"]).toEqual([group]);
  });

  it("finds no mismatch between the two parsers over the bundle those acts wrote", async () => {
    const scenario = await arrange();
    await buildTheMap(scenario);

    const audit = await enqueueJob(scenario.admin, scenario.postgres, {
      kind: "nightly-audit",
    });
    expect(audit.ok).toBe(true);
    await runWorkerOnce();

    const outcome = await db().pool.query<{
      outcome: {
        readonly checked: number;
        readonly mismatched: readonly unknown[];
        readonly unparsed: readonly string[];
        readonly missing_row: readonly string[];
        readonly missing_file: readonly string[];
      };
      status: string;
    }>("SELECT status, outcome FROM job WHERE workspace_id = $1 AND kind = 'nightly-audit'", [
      scenario.workspaceId,
    ]);

    const found = outcome.rows[0];
    expect(found?.status).toBe("done");
    // Every file read, every hash agreed, nothing unreadable and nothing missing on either
    // side: the two parsers are one parser, said as a number.
    expect({
      mismatched: found?.outcome.mismatched,
      unparsed: found?.outcome.unparsed,
      missingRow: found?.outcome.missing_row,
      missingFile: found?.outcome.missing_file,
    }).toEqual({ mismatched: [], unparsed: [], missingRow: [], missingFile: [] });
    expect(found?.outcome.checked).toBeGreaterThan(4);
  });
});
