import { describe, expect, it } from "vitest";

import { ulid } from "@better-answers/schema";

import {
  writeConcept,
  writeManifest,
  type ManifestWritten,
  type WriteManifestInput,
} from "../src/concepts/index.ts";
import type { UserPrincipal } from "../src/kernel/index.ts";
import { head, PLATFORM_BOT } from "@better-answers/core/store/git";
import { bundleHistory, commitFacts, fileAtCommit, removeRepository } from "./bundle.ts";
import { doorsOf, suiteWithBundles, type Scenario } from "./workspace-with-bundle.ts";

const { db, arrange } = suiteWithBundles();

const BUNDLE_ID = "01J6BBBBBBBBBBBBBBBBBBBBBB";

const manifestFor = (
  overrides: Partial<WriteManifestInput["manifest"]> = {},
): WriteManifestInput => ({
  manifest: {
    id: BUNDLE_ID,
    origin: "company",
    ref: "Four bid libraries, reviewed 22 September 2026",
    owner: "Acme",
    content_version: "2026-09-22",
    ...overrides,
  },
  message: "Write the bundle's manifest",
  author: { name: "Ada Editor", email: "ada@acme.invalid" },
});

const write = (scenario: Scenario, principal: UserPrincipal, input: WriteManifestInput) =>
  writeManifest(principal, doorsOf(scenario), input);

const written = async (scenario: Scenario, input: WriteManifestInput = manifestFor()) => {
  const result = await write(scenario, scenario.editor, input);
  if (!result.ok) throw new Error(`the manifest was refused: ${String(result.error)}`);
  return result.value;
};

const rowsFor = async (workspaceId: string) => {
  const counted = await db().pool.query<Record<string, string>>(
    `SELECT (SELECT count(*) FROM concept_index WHERE workspace_id = $1) AS concepts,
            (SELECT count(*) FROM bundle_commit WHERE workspace_id = $1) AS commits,
            (SELECT count(*) FROM audit_event WHERE workspace_id = $1 AND act LIKE 'knowledge.%') AS events`,
    [workspaceId],
  );
  return counted.rows[0];
};

const knowledgeEventsOf = async (workspaceId: string) => {
  const found = await db().pool.query<Record<string, unknown>>(
    `SELECT e.act, e.actor, e.subject_kind, e.subject_id, e.detail, c.sha, c.parent_sha, c.actor AS committer
       FROM audit_event e
       LEFT JOIN bundle_commit c ON c.workspace_id = e.workspace_id AND c.audit_event_id = e.id
      WHERE e.workspace_id = $1 AND e.act LIKE 'knowledge.%'
      ORDER BY e.at, e.id`,
    [workspaceId],
  );
  return found.rows;
};

const onlyTheStandingManifest = async (scenario: Scenario, landed: ManifestWritten) => {
  expect(await bundleHistory(scenario.git, scenario.workspaceId)).toEqual([
    landed.written ? landed.sha : "",
  ]);
  expect(await rowsFor(scenario.workspaceId)).toEqual({ concepts: "0", commits: "1", events: "1" });
};

const nothingWritten = async (scenario: Scenario) => {
  expect(await head(scenario.editor, scenario.git)).toBeNull();
  expect(await rowsFor(scenario.workspaceId)).toEqual({ concepts: "0", commits: "0", events: "0" });
};

describe("the manifest, the bundle's first commit", () => {
  it("lands one commit with its event and row, no concept", async () => {
    const scenario = await arrange();

    const landed = await written(scenario);

    expect(landed).toEqual({
      written: true,
      sha: expect.any(String),
      auditEventId: expect.any(String),
    });
    if (!landed.written) throw new Error("unreachable: asserted above");
    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toEqual([landed.sha]);
    const facts = await commitFacts(scenario.git, scenario.workspaceId, landed.sha);
    expect({
      subject: facts.subject,
      author: facts.author,
      committer: facts.committer,
      parents: facts.parents,
      files: facts.files,
      trailers: facts.trailers,
    }).toEqual({
      subject: "Write the bundle's manifest",
      author: "Ada Editor <ada@acme.invalid>",
      committer: `${PLATFORM_BOT.name} <${PLATFORM_BOT.email}>`,
      parents: [],
      files: ["knowledge/manifest.yaml"],
      trailers: { Actor: `human:${scenario.editor.userId}`, Audit: landed.auditEventId },
    });
    expect(
      await fileAtCommit(scenario.git, scenario.workspaceId, landed.sha, "knowledge/manifest.yaml"),
    ).toBe(
      [
        '"id": "01J6BBBBBBBBBBBBBBBBBBBBBB"',
        '"origin": "company"',
        '"ref": "Four bid libraries, reviewed 22 September 2026"',
        '"owner": "Acme"',
        '"content_version": "2026-09-22"',
        "",
      ].join("\n"),
    );
    expect(await knowledgeEventsOf(scenario.workspaceId)).toEqual([
      {
        act: "knowledge.manifest.written",
        actor: `human:${scenario.editor.userId}`,
        subject_kind: "manifest",
        subject_id: BUNDLE_ID,
        detail: { bundleId: BUNDLE_ID, commitSha: landed.sha },
        sha: landed.sha,
        parent_sha: null,
        committer: `human:${scenario.editor.userId}`,
      },
    ]);
    expect(await rowsFor(scenario.workspaceId)).toEqual({
      concepts: "0",
      commits: "1",
      events: "1",
    });
  });

  it("lands on the head it found when concepts already stand", async () => {
    const scenario = await arrange();
    const first = await writeConcept(scenario.editor, doorsOf(scenario), {
      mergeKey: "policy:expenses",
      path: "knowledge/expenses.md",
      kind: "Policy",
      title: "Expenses",
      frontmatter: { title: "Expenses", type: "Policy" },
      body: "Expenses are claimed within thirty days.",
      message: "Record the expenses policy",
      author: { name: "Ada Editor", email: "ada@acme.invalid" },
      expects: { head: null },
    });
    if (!first.ok) throw new Error(`the concept was refused: ${String(first.error)}`);

    const landed = await written(scenario);
    if (!landed.written) throw new Error("the manifest was not written");

    const facts = await commitFacts(scenario.git, scenario.workspaceId, landed.sha);
    expect(facts.parents).toEqual([first.value.sha]);
    expect(facts.files).toEqual(["knowledge/expenses.md", "knowledge/manifest.yaml"]);
    expect(await rowsFor(scenario.workspaceId)).toEqual({
      concepts: "1",
      commits: "2",
      events: "2",
    });
  });

  it("writes nothing the second time for the same bundle id", async () => {
    const scenario = await arrange();
    const landed = await written(scenario);

    const again = await write(
      scenario,
      scenario.admin,
      manifestFor({ content_version: "2026-10-01", ref: "The same libraries, re-reviewed" }),
    );

    expect(again).toEqual({ ok: true, value: { written: false } });
    await onlyTheStandingManifest(scenario, landed);
  });

  it("refuses another bundle id and leaves the standing manifest alone", async () => {
    const scenario = await arrange();
    const landed = await written(scenario);

    const other = await write(scenario, scenario.editor, manifestFor({ id: ulid() }));

    expect(other).toEqual({ ok: false, error: "path-taken" });
    await onlyTheStandingManifest(scenario, landed);
  });

  it.each([
    ["an id that is not the minter's", manifestFor({ id: "acme-2026" })],
    ["a blank owner", manifestFor({ owner: "  " })],
    ["a blank content version", manifestFor({ content_version: "" })],
  ])("refuses %s, writing nothing", async (_why, input) => {
    const scenario = await arrange();

    const refused = await write(scenario, scenario.editor, input);

    expect(refused).toEqual({ ok: false, error: "malformed" });
    await nothingWritten(scenario);
  });

  it("refuses a Viewer before anything is written", async () => {
    const scenario = await arrange();

    const refused = await write(scenario, scenario.viewer, manifestFor());

    expect(refused).toEqual({ ok: false, error: "role-forbids" });
    await nothingWritten(scenario);
  });

  it("refuses a workspace with no bundle rather than making one", async () => {
    const scenario = await arrange();
    await removeRepository(scenario.git, scenario.workspaceId);

    const refused = await write(scenario, scenario.editor, manifestFor());

    expect(refused).toEqual({ ok: false, error: "no-such-repository" });
    await nothingWritten(scenario);
  });
});
