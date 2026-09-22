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
import { narrowBinding, narrowBindingInput } from "../src/sources/index.ts";
import { inputOf } from "./suite-input.ts";
import { readingAs } from "./suite-postgres.ts";
import { runWorkerOnce } from "./worker-process.ts";
import { bindingHolding, groupNamed } from "./sourced-concept.ts";
import { doorsOf, suiteWithBundles, type Scenario } from "./workspace-with-bundle.ts";

const { db, bundles, arrange } = suiteWithBundles();

const runTheWorker = (): Promise<void> =>
  runWorkerOnce(db().connectionUri, bundles().root, "rebuild-equivalence");

let sequence = 0;

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

const nodesAt = async (workspaceId: string, gen: number) => {
  const rows = await db().pool.query(
    `SELECT uid, label, kind, published_at, sensitivity, audience, audience_groups
       FROM graph_node WHERE workspace_id = $1 AND gen = $2 ORDER BY uid`,
    [workspaceId, gen],
  );
  return rows.rows;
};

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

const buildTheMap = async (scenario: Scenario) => {
  const binding = await bindingHolding(db(), scenario.workspaceId);
  const group = await groupNamed(db(), scenario, "HR", [scenario.editor]);

  const superseded = await wrote(scenario, scenario.editor, {
    body: "The old rule stood until it did not.",
  });

  const derivedFrom = await wrote(scenario, scenario.editor, {
    body: "The evidence this rests on.",
  });

  // This path's concept is written after the linker, so the live map gains the linker's edge
  // through the re-derive.
  const laterPath = `knowledge/lands-later-${ulid().toLowerCase()}.md`;

  const unlanded = conceptIriOf(ulid());

  const linker = await wrote(scenario, scenario.editor, {
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

    frontmatter: {
      title: "The linker",
      type: "Note",
      sources: [
        { resource: superseded.iri, locator: "p.1" },
        { resource: derivedFrom.iri, locator: "p.2" },
      ],
    },

    evidence: [{ sourceDocumentId: binding.documentId, locator: "p.1", resource: "The handbook" }],
  });

  await wrote(scenario, scenario.editor, {
    path: laterPath,
    body: "The concept the link was waiting for.",
  });

  await accepted(scenario, {
    body: `Accepted, and it cites [the linker](/${linker.path}) once.`,
  });

  await wrote(scenario, scenario.editor, {
    iri: superseded.iri,
    path: superseded.path,
    mergeKey: superseded.mergeKey,
    title: superseded.title,
    body: "The old rule stood until it did not.",
    status: "deprecated",
  });

  const narrowed = await readingAs(db().runtimePool, scenario.admin, (admin, tx) =>
    narrowBinding(
      admin,
      tx,
      inputOf(narrowBindingInput, {
        bindingId: binding.bindingId,
        sensitivity: "Internal",
        audience: "groups",
        audienceGroups: [group],
      }),
    ),
  );
  if (!narrowed.ok) throw new Error(`the narrowing was refused: ${String(narrowed.error)}`);

  return { linker, group };
};

const EQUIVALENCE_ALLOWANCE_MS = 120_000;

describe("the worker's rebuild against the app's own map", () => {
  it(
    "reproduces the live generation exactly, column by column, from the bundle and the records",
    async () => {
      const scenario = await arrange();
      const { linker, group } = await buildTheMap(scenario);

      const live = await liveGenerationOf(scenario.workspaceId);
      expect(live, "the app's acts wrote a live generation").toBe(1);
      const liveNodes = await nodesAt(scenario.workspaceId, 1);
      const liveEdges = await edgesAt(scenario.workspaceId, 1);

      expect(liveNodes.length).toBeGreaterThan(4);
      expect(liveEdges.length).toBeGreaterThan(6);

      const queued = await enqueueJob(scenario.admin, scenario.postgres, {
        workspaceId: scenario.workspaceId,
        kind: "full-rebuild",
        reason: "drill",
      });
      expect(queued.ok, "the rebuild was queued through the runs slice").toBe(true);

      const audit = await enqueueJob(scenario.admin, scenario.postgres, {
        workspaceId: scenario.workspaceId,
        kind: "nightly-audit",
      });
      expect(audit.ok).toBe(true);

      await runTheWorker();
      await runTheWorker();

      expect(await liveGenerationOf(scenario.workspaceId)).toBe(2);
      expect(await nodesAt(scenario.workspaceId, 2)).toEqual(liveNodes);
      expect(await edgesAt(scenario.workspaceId, 2)).toEqual(liveEdges);

      const linkerEdges = liveEdges.filter((edge) => edge["from_uid"] === linker.iri);

      expect(linkerEdges.map((edge) => edge["label"]).toSorted()).toEqual([
        "DERIVED_FROM",
        ...Array.from({ length: 7 }, () => "LINKS_TO"),
        "SUPERSEDES",
      ]);
      const linked = linkerEdges.find((edge) => edge["label"] === "LINKS_TO");
      expect(linked?.["section"]).toBe("Details");
      expect(linked?.["sentence"]).toMatch(/^It names an inline link and/u);
      expect(linked?.["audience_groups"]).toEqual([group]);
    },
    EQUIVALENCE_ALLOWANCE_MS,
  );

  it("finds no mismatch between the two parsers over the bundle those acts wrote", async () => {
    const scenario = await arrange();
    await buildTheMap(scenario);

    const audit = await enqueueJob(scenario.admin, scenario.postgres, {
      workspaceId: scenario.workspaceId,
      kind: "nightly-audit",
    });
    expect(audit.ok).toBe(true);
    await runTheWorker();

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

    expect({
      mismatched: found?.outcome.mismatched,
      unparsed: found?.outcome.unparsed,
      missingRow: found?.outcome.missing_row,
      missingFile: found?.outcome.missing_file,
    }).toEqual({ mismatched: [], unparsed: [], missingRow: [], missingFile: [] });
    expect(found?.outcome.checked).toBeGreaterThan(4);
  });
});
