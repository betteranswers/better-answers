import { describe, expect, it } from "vitest";

import { head } from "@better-answers/core/store/git";

import {
  importBundle,
  writeConcept,
  writeManifest,
  type BundleImported,
  type BundleTree,
  type ImportBundleInput,
} from "../src/concepts/index.ts";
import type { UserPrincipal } from "../src/kernel/index.ts";
import { bundleHistory, commitFacts, fileAtCommit } from "./bundle.ts";
import { addressOf } from "./suite-postgres.ts";
import { doorsOf, memberOf, suiteWithBundles, type Scenario } from "./workspace-with-bundle.ts";

const { db, arrange } = suiteWithBundles();

const BUNDLE_ID = "01J6CCCCCCCCCCCCCCCCCCCCCC";

const MANIFEST = `id: ${BUNDLE_ID}
origin: company
ref: Two answer libraries, reviewed 22 September 2026
owner: Acme Software Ltd
content_version: 2026-09-22
`;

const CHECKED_AT = "2026-04-16T00:00:00Z";
const CHECKED_AGAIN_AT = "2026-06-01T09:30:00Z";

type Event = { readonly by: string; readonly at: string };

type Concept = {
  readonly title: string;
  readonly body: string;
  readonly type?: string;
  readonly tags?: string;
  readonly entry?: string;
  readonly verified?: readonly Event[];
  readonly frontmatter?: string;
};

const conceptFile = (concept: Concept): string => {
  const entry = concept.entry ?? "ENTRY-001";
  const verified =
    concept.verified === undefined
      ? ""
      : `verified:\n${concept.verified.map((event) => `  - { by: ${event.by}, at: ${event.at} }`).join("\n")}\n`;
  return `---
type: ${concept.type ?? "Answer"}
title: ${concept.title}
description: One sentence a listing shows.
tags: [${concept.tags ?? "company"}]
generated: { by: claude-code/claude-fable-5-1, at: 2026-09-22T00:30:00Z }
${verified}${concept.frontmatter ?? ""}sources:
  - id: ${entry}
    resource: ../sources/Acme_Bid_Library_v1.md
    title: Acme Bid Library v1, entry ${entry}
    last_modified: 2026-03-01
---

${concept.body}
`;
};

const treeOf = (files: Readonly<Record<string, string>>): BundleTree =>
  new Map(Object.entries(files));

type Verifiers = { readonly mona: string; readonly theo: string };

const humanOf = (email: string): string => `human:${email}`;

const soundBundle = (verifiers: Verifiers): BundleTree => {
  const byMona = { by: humanOf(verifiers.mona), at: CHECKED_AT };
  const byTheo = { by: humanOf(verifiers.theo), at: CHECKED_AGAIN_AT };
  return treeOf({
    "manifest.yaml": MANIFEST,
    "index.md":
      "# Subdirectories\n\n* [company](company/index.md)\n* [product](product/index.md)\n",
    "log.md": "# Log\n\n## 2026-09-22\n\nMade from the two libraries.\n",
    "company/index.md": "# Subdirectories\n\n* [answers](answers/index.md)\n",
    "company/answers/index.md": "# Concepts\n\n* [Support hours](support-hours.md)\n",
    "company/answers/support-hours.md": conceptFile({
      title: "Support hours",
      entry: "ENTRY-001",
      verified: [byMona],
      body: "Support answers between 08:00 and 18:00 on working days. [Advanced plan](../../product/tiers/advanced-plan.md) customers reach an engineer out of hours.",
    }),
    "company/answers/data-retention-period.md": conceptFile({
      title: "Data retention period",
      entry: "ENTRY-002",
      tags: "company, g-cloud-15",
      verified: [byMona, byTheo],
      body: "Customer data is kept for the life of the contract and ninety days after.\n\n## G-Cloud 15 Service Definition\n\nRetention is ninety days beyond termination, then deletion is certified in writing.",
    }),
    "product/tiers/standard-plan.md": conceptFile({
      type: "Tier",
      title: "Standard plan",
      tags: "product, standard",
      entry: "standard-plan",
      verified: [byMona],
      body: "The Standard plan is one of the two plans of the product.",
    }),
    "product/tiers/advanced-plan.md": conceptFile({
      type: "Tier",
      title: "Advanced plan",
      tags: "product, advanced",
      entry: "advanced-plan",
      verified: [byMona],
      body: "The Advanced plan adds encrypted case data and out-of-hours support.",
    }),
    "product/answers/can-two-teams-share-one-account-standard-plan.md": conceptFile({
      title: "Can two teams share one account? (Standard plan)",
      tags: "product, standard",
      entry: "PROD-013",
      verified: [byMona],
      body: "Yes, under one data-sharing agreement; access follows the team by default.\n\nThis answer is for the [Standard plan](../tiers/standard-plan.md).",
    }),
    "product/answers/can-two-teams-share-one-account-advanced-plan.md": conceptFile({
      title: "Can two teams share one account? (Advanced plan)",
      tags: "product, advanced",
      entry: "PROD-013",
      verified: [byMona],
      body: "Yes, and each case is granted to named people alone. The [Standard plan's answer](./can-two-teams-share-one-account-standard-plan.md) is the looser default.\n\nThis answer is for the [Advanced plan](../tiers/advanced-plan.md).",
    }),
  });
};

const PATHS_IN_ORDER = [
  "knowledge/company/answers/data-retention-period.md",
  "knowledge/company/answers/support-hours.md",
  "knowledge/product/answers/can-two-teams-share-one-account-advanced-plan.md",
  "knowledge/product/answers/can-two-teams-share-one-account-standard-plan.md",
  "knowledge/product/tiers/advanced-plan.md",
  "knowledge/product/tiers/standard-plan.md",
] as const;

type Arranged = {
  readonly scenario: Scenario;
  readonly verifiers: Verifiers;
  readonly people: { readonly mona: string; readonly theo: string };
};

const arranged = async (): Promise<Arranged> => {
  const scenario = await arrange();
  const verifiers = { mona: addressOf("mona"), theo: addressOf("theo") };
  const mona = await memberOf(db().pool, scenario.workspaceId, verifiers.mona);
  const theo = await memberOf(db().pool, scenario.workspaceId, verifiers.theo);
  return { scenario, verifiers, people: { mona: mona.id, theo: theo.id } };
};

const importing = (
  scenario: Scenario,
  principal: UserPrincipal,
  input: ImportBundleInput,
): ReturnType<typeof importBundle> => importBundle(principal, doorsOf(scenario), input);

const imported = async (
  scenario: Scenario,
  tree: BundleTree,
  overrides: Partial<ImportBundleInput> = {},
): Promise<BundleImported> => {
  const run = await importing(scenario, scenario.editor, { tree, ...overrides });
  if (!run.ok) throw new Error(`the import was refused: ${JSON.stringify(run.error)}`);
  return run.value;
};

const COUNTED_TABLES = {
  concepts: "concept_index",
  commits: "bundle_commit",
  checks: "concept_verification",
} as const;

const rowsFor = async (workspaceId: string) => {
  const counts: Record<string, string> = {};
  for (const [name, table] of Object.entries(COUNTED_TABLES)) {
    const counted = await db().pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM ${table} WHERE workspace_id = $1`,
      [workspaceId],
    );
    counts[name] = counted.rows[0]?.n ?? "";
  }
  const events = await db().pool.query<{ n: string }>(
    "SELECT count(*) AS n FROM audit_event WHERE workspace_id = $1 AND act LIKE 'knowledge.%'",
    [workspaceId],
  );
  return { ...counts, events: events.rows[0]?.n ?? "" };
};

const nothingWritten = async (scenario: Scenario) => {
  const [sha, rows] = await Promise.all([
    head(scenario.editor, scenario.git),
    rowsFor(scenario.workspaceId),
  ]);
  expect({ head: sha, ...rows }).toEqual({
    head: null,
    concepts: "0",
    commits: "0",
    checks: "0",
    events: "0",
  });
};

const indexRows = async (workspaceId: string) => {
  const found = await db().pool.query<Record<string, unknown>>(
    `SELECT path, kind, title, status, sensitivity
       FROM concept_index WHERE workspace_id = $1 ORDER BY path`,
    [workspaceId],
  );
  return found.rows;
};

const checkRows = async (workspaceId: string) => {
  const found = await db().pool.query<Record<string, unknown>>(
    `SELECT c.path, v.actor, v.checked_at, v.content_hash, v.origin
       FROM concept_verification v
       JOIN concept_index c ON c.workspace_id = v.workspace_id AND c.iri = v.iri
      WHERE v.workspace_id = $1
      ORDER BY c.path, v.checked_at`,
    [workspaceId],
  );
  return found.rows;
};

const ledgerOf = async (workspaceId: string) => {
  const found = await db().pool.query<Record<string, unknown>>(
    `SELECT act, actor, subject_kind, batch_id
       FROM audit_event WHERE workspace_id = $1 AND act LIKE 'knowledge.%'
      ORDER BY at, id`,
    [workspaceId],
  );
  return found.rows;
};

const authorOf = async (principal: UserPrincipal): Promise<string> => {
  const found = await db().pool.query<{ name: string; email: string }>(
    'SELECT name, email FROM "user" WHERE id = $1',
    [principal.userId],
  );
  const row = found.rows[0];
  if (row === undefined) throw new Error("the principal has no user row");
  return `${row.name} <${row.email}>`;
};

const standingConcept = (scenario: Scenario, mergeKey: string) =>
  writeConcept(scenario.editor, doorsOf(scenario), {
    mergeKey,
    path: "knowledge/elsewhere.md",
    kind: "Answer",
    title: "Elsewhere",
    frontmatter: { title: "Elsewhere", type: "Answer" },
    body: "A concept that already stands.",
    message: "Record a standing concept",
    author: { name: "Ada Editor", email: "ada@acme.invalid" },
    expects: { head: null },
  });

describe("importing the bundle", () => {
  it("lands the manifest first and every concept in path order through the governed write, each as its own commit", async () => {
    const { scenario, verifiers } = await arranged();

    const run = await imported(scenario, soundBundle(verifiers));

    expect(run).toEqual({
      bundleId: BUNDLE_ID,
      manifest: "written",
      landed: PATHS_IN_ORDER,
      skipped: [],
      checks: { recorded: 7, present: 0 },
      concepts: 6,
      dryRun: false,
    });
    const history = await bundleHistory(scenario.git, scenario.workspaceId);
    expect(history).toHaveLength(7);
    const first = await commitFacts(scenario.git, scenario.workspaceId, history[0] ?? "");
    expect({ subject: first.subject, files: first.files, parents: first.parents }).toEqual({
      subject: "Write the bundle's manifest",
      files: ["knowledge/manifest.yaml"],
      parents: [],
    });
    const second = await commitFacts(scenario.git, scenario.workspaceId, history[1] ?? "");
    expect({ subject: second.subject, author: second.author, trailers: second.trailers }).toEqual({
      subject:
        "Import knowledge/company/answers/data-retention-period.md from Acme Bid Library v1, entry ENTRY-002",
      author: await authorOf(scenario.editor),
      trailers: { Actor: `human:${scenario.editor.userId}`, Audit: expect.any(String) },
    });
    expect(await indexRows(scenario.workspaceId)).toEqual([
      {
        path: "knowledge/company/answers/data-retention-period.md",
        kind: "Answer",
        title: "Data retention period",
        status: "stable",
        sensitivity: "Internal",
      },
      {
        path: "knowledge/company/answers/support-hours.md",
        kind: "Answer",
        title: "Support hours",
        status: "stable",
        sensitivity: "Internal",
      },
      {
        path: "knowledge/product/answers/can-two-teams-share-one-account-advanced-plan.md",
        kind: "Answer",
        title: "Can two teams share one account? (Advanced plan)",
        status: "stable",
        sensitivity: "Internal",
      },
      {
        path: "knowledge/product/answers/can-two-teams-share-one-account-standard-plan.md",
        kind: "Answer",
        title: "Can two teams share one account? (Standard plan)",
        status: "stable",
        sensitivity: "Internal",
      },
      {
        path: "knowledge/product/tiers/advanced-plan.md",
        kind: "Tier",
        title: "Advanced plan",
        status: "stable",
        sensitivity: "Internal",
      },
      {
        path: "knowledge/product/tiers/standard-plan.md",
        kind: "Tier",
        title: "Standard plan",
        status: "stable",
        sensitivity: "Internal",
      },
    ]);
  });

  it("writes the file in the platform's own form: the verifier as a person id, no email, the source kept as a projection, status stable and the minted iri", async () => {
    const { scenario, verifiers, people } = await arranged();

    await imported(scenario, soundBundle(verifiers));

    const history = await bundleHistory(scenario.git, scenario.workspaceId);
    const file = await fileAtCommit(
      scenario.git,
      scenario.workspaceId,
      history.at(-1) ?? "",
      "knowledge/company/answers/data-retention-period.md",
    );
    const iri = /"iri": "([^"]+)"/.exec(file)?.[1] ?? "";
    expect(iri).toMatch(/^https:\/\/better-answers\.com\/c\/[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(file).toBe(
      [
        "---",
        '"type": "Answer"',
        '"title": "Data retention period"',
        '"description": "One sentence a listing shows."',
        '"tags":',
        '  - "company"',
        '  - "g-cloud-15"',
        '"generated":',
        '  - "by": "claude-code/claude-fable-5-1"',
        '    "at": "2026-09-22T00:30:00Z"',
        '"verified":',
        `  - "by": "human:${people.mona}"`,
        '    "at": "2026-04-16T00:00:00Z"',
        `  - "by": "human:${people.theo}"`,
        '    "at": "2026-06-01T09:30:00Z"',
        '"sources":',
        '  - "id": "ENTRY-002"',
        '    "resource": "../sources/Acme_Bid_Library_v1.md"',
        '    "title": "Acme Bid Library v1, entry ENTRY-002"',
        '    "last_modified": "2026-03-01"',
        '"status": "stable"',
        `"iri": "${iri}"`,
        "---",
        "",
        "Customer data is kept for the life of the contract and ninety days after.",
        "",
        "## G-Cloud 15 Service Definition",
        "",
        "Retention is ninety days beyond termination, then deletion is certified in writing.",
        "",
      ].join("\n"),
    );
    expect(file).not.toContain("@");
  });

  it("records every verified event as an imported check with a null hash, one audit event each under the run's batch id", async () => {
    const { scenario, verifiers, people } = await arranged();

    await imported(scenario, soundBundle(verifiers));

    const checks = await checkRows(scenario.workspaceId);
    expect(checks).toHaveLength(7);
    expect(checks.slice(0, 2)).toEqual([
      {
        path: "knowledge/company/answers/data-retention-period.md",
        actor: `human:${people.mona}`,
        checked_at: new Date("2026-04-16T00:00:00.000Z"),
        content_hash: null,
        origin: "imported",
      },
      {
        path: "knowledge/company/answers/data-retention-period.md",
        actor: `human:${people.theo}`,
        checked_at: new Date("2026-06-01T09:30:00.000Z"),
        content_hash: null,
        origin: "imported",
      },
    ]);
    const ledger = await ledgerOf(scenario.workspaceId);
    expect(ledger.map((row) => row["subject_kind"]).join(" ")).toBe(
      "manifest concept check check concept check concept check concept check concept check concept check",
    );
    expect(
      new Set(ledger.map((row) => `${String(row["act"])} on a ${String(row["subject_kind"])}`)),
    ).toEqual(
      new Set([
        "knowledge.manifest.written on a manifest",
        "knowledge.concept.committed on a concept",
        "knowledge.check.imported on a check",
      ]),
    );
    const batches = new Set(
      ledger
        .filter((row) => row["act"] === "knowledge.check.imported")
        .map((row) => row["batch_id"]),
    );
    expect(batches.size).toBe(1);
    expect([...batches][0]).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(new Set(ledger.map((row) => row["actor"]))).toEqual(
      new Set([`human:${scenario.editor.userId}`]),
    );
  });

  it("skips what already landed on a rerun, records no second check for the same actor and instant, and says so", async () => {
    const { scenario, verifiers } = await arranged();
    await imported(scenario, soundBundle(verifiers));

    const again = await imported(scenario, soundBundle(verifiers));

    expect(again).toEqual({
      bundleId: BUNDLE_ID,
      manifest: "standing",
      landed: [],
      skipped: PATHS_IN_ORDER,
      checks: { recorded: 0, present: 7 },
      concepts: 6,
      dryRun: false,
    });
    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toHaveLength(7);
    expect(await rowsFor(scenario.workspaceId)).toEqual({
      concepts: "6",
      commits: "7",
      checks: "7",
      events: "14",
    });
  });

  it("stops at the concept whose merge key another already holds, keeps what landed, and completes on a rerun once the key is free", async () => {
    const { scenario, verifiers } = await arranged();
    const standing = await standingConcept(
      scenario,
      "Answer:can two teams share one account? (advanced plan)",
    );
    if (!standing.ok)
      throw new Error(`the standing concept was refused: ${String(standing.error)}`);

    const stopped = await importing(scenario, scenario.editor, { tree: soundBundle(verifiers) });

    expect(stopped).toEqual({
      ok: false,
      error: {
        kind: "stopped",
        file: "product/answers/can-two-teams-share-one-account-advanced-plan.md",
        reason: "merge-key-taken",
        progress: {
          landed: [
            "knowledge/company/answers/data-retention-period.md",
            "knowledge/company/answers/support-hours.md",
          ],
          skipped: [],
          checks: { recorded: 3, present: 0 },
        },
      },
    });
    expect(await rowsFor(scenario.workspaceId)).toEqual({
      concepts: "3",
      commits: "4",
      checks: "3",
      events: "7",
    });

    const freed = await writeConcept(scenario.admin, doorsOf(scenario), {
      iri: standing.value.iri,
      mergeKey: "Answer:elsewhere",
      path: "knowledge/elsewhere.md",
      kind: "Answer",
      title: "Elsewhere",
      frontmatter: { title: "Elsewhere", type: "Answer" },
      body: "A concept that already stands.",
      message: "Move the standing concept onto its own key",
      author: { name: "Ada Editor", email: "ada@acme.invalid" },
      expects: { base: standing.value.contentHash },
    });
    if (!freed.ok) throw new Error(`the rewrite was refused: ${String(freed.error)}`);
    const completed = await imported(scenario, soundBundle(verifiers));

    expect(completed).toEqual({
      bundleId: BUNDLE_ID,
      manifest: "standing",
      landed: [
        "knowledge/product/answers/can-two-teams-share-one-account-advanced-plan.md",
        "knowledge/product/answers/can-two-teams-share-one-account-standard-plan.md",
        "knowledge/product/tiers/advanced-plan.md",
        "knowledge/product/tiers/standard-plan.md",
      ],
      skipped: [
        "knowledge/company/answers/data-retention-period.md",
        "knowledge/company/answers/support-hours.md",
      ],
      checks: { recorded: 4, present: 3 },
      concepts: 6,
      dryRun: false,
    });
    expect(await checkRows(scenario.workspaceId)).toHaveLength(7);
  });

  it("reports what a run would do on a dry run and writes nothing", async () => {
    const { scenario, verifiers } = await arranged();

    const run = await imported(scenario, soundBundle(verifiers), { dryRun: true });

    expect(run).toEqual({
      bundleId: BUNDLE_ID,
      manifest: "would-write",
      landed: PATHS_IN_ORDER,
      skipped: [],
      checks: { recorded: 7, present: 0 },
      concepts: 6,
      dryRun: true,
    });
    await nothingWritten(scenario);
  });

  it("lands every concept at the class the caller names", async () => {
    const { scenario, verifiers } = await arranged();

    await imported(scenario, soundBundle(verifiers), { sensitivity: "Restricted" });

    expect(
      new Set((await indexRows(scenario.workspaceId)).map((row) => row["sensitivity"])),
    ).toEqual(new Set(["Restricted"]));
  });
});

describe("what the import refuses before it writes anything", () => {
  const withMona = (verifiers: Verifiers): Event => ({
    by: humanOf(verifiers.mona),
    at: CHECKED_AT,
  });

  const oneConcept = (verifiers: Verifiers, file: string, concept: Concept): BundleTree =>
    treeOf({
      "manifest.yaml": MANIFEST,
      [file]: conceptFile({ verified: [withMona(verifiers)], ...concept }),
    });

  const supportHours = (verifiers: Verifiers): string =>
    conceptFile({ title: "Support hours", verified: [withMona(verifiers)], body: "Text." });

  it.each([
    [
      "a file whose frontmatter is not YAML",
      (verifiers: Verifiers) =>
        treeOf({
          "manifest.yaml": MANIFEST,
          "company/answers/broken.md": conceptFile({
            title: "Broken",
            verified: [withMona(verifiers)],
            frontmatter: "owner: a: b\n",
            body: "Text.",
          }),
        }),
      {
        file: "company/answers/broken.md",
        reason: "does-not-parse",
        about: expect.stringContaining("Nested mappings are not allowed"),
      },
    ],
    [
      "a file with no frontmatter fence",
      () => treeOf({ "manifest.yaml": MANIFEST, "company/answers/bare.md": "Just a body.\n" }),
      { file: "company/answers/bare.md", reason: "does-not-parse", about: "no frontmatter fence" },
    ],
    [
      "a file whose verified event has no instant",
      (verifiers: Verifiers) =>
        oneConcept(verifiers, "company/answers/undated.md", {
          title: "Undated",
          body: "Text.",
          verified: [{ by: humanOf(verifiers.mona), at: "yesterday" }],
        }),
      { file: "company/answers/undated.md", reason: "does-not-parse", about: "verified[0].at" },
    ],
    [
      "a file with no title",
      (verifiers: Verifiers) =>
        treeOf({
          "manifest.yaml": MANIFEST,
          "company/answers/untitled.md": `---\ntype: Answer\nverified:\n  - { by: ${humanOf(verifiers.mona)}, at: ${CHECKED_AT} }\n---\n\nText.\n`,
        }),
      { file: "company/answers/untitled.md", reason: "type-or-title-missing", about: "title" },
    ],
    [
      "a link to a file that is not a concept in the tree",
      (verifiers: Verifiers) =>
        oneConcept(verifiers, "company/answers/dangling.md", {
          title: "Dangling",
          body: "See the [Premium plan](../../product/tiers/premium-plan.md).",
        }),
      {
        file: "company/answers/dangling.md",
        reason: "link-outside-tree",
        about: "../../product/tiers/premium-plan.md",
      },
    ],
    [
      "a verifier who is not a member of the workspace",
      () =>
        oneConcept({ mona: "", theo: "" }, "company/answers/stranger.md", {
          title: "Stranger",
          body: "Text.",
          verified: [{ by: "human:nobody@elsewhere.invalid", at: CHECKED_AT }],
        }),
      {
        file: "company/answers/stranger.md",
        reason: "verifier-not-a-member",
        about: "nobody@elsewhere.invalid",
      },
    ],
    [
      "a verifier who is not a person",
      () =>
        oneConcept({ mona: "", theo: "" }, "company/answers/machine.md", {
          title: "Machine",
          body: "Text.",
          verified: [{ by: "better-answers-judge/1", at: CHECKED_AT }],
        }),
      {
        file: "company/answers/machine.md",
        reason: "verifier-not-a-member",
        about: "better-answers-judge/1",
      },
    ],
    [
      "a file at the path the erasure drill keeps",
      (verifiers: Verifiers) =>
        oneConcept(verifiers, "erasure-rehearsal.md", { title: "Rehearsal", body: "Text." }),
      {
        file: "erasure-rehearsal.md",
        reason: "reserved-path",
        about: "knowledge/erasure-rehearsal.md",
      },
    ],
    [
      "a file at a path the platform cannot hold",
      (verifiers: Verifiers) =>
        oneConcept(verifiers, "company/answers/with space.md", { title: "Spaced", body: "Text." }),
      {
        file: "company/answers/with space.md",
        reason: "path-refused",
        about: "knowledge/company/answers/with space.md",
      },
    ],
    [
      "two files that derive one merge key",
      (verifiers: Verifiers) =>
        treeOf({
          "manifest.yaml": MANIFEST,
          "company/answers/support-hours.md": supportHours(verifiers),
          "product/answers/support-hours-again.md": conceptFile({
            title: "support  HOURS",
            verified: [withMona(verifiers)],
            body: "Other text.",
          }),
        }),
      {
        file: "product/answers/support-hours-again.md",
        reason: "merge-key-clash",
        about: "company/answers/support-hours.md",
      },
    ],
    [
      "a tree with no manifest",
      (verifiers: Verifiers) =>
        treeOf({ "company/answers/support-hours.md": supportHours(verifiers) }),
      { file: "manifest.yaml", reason: "manifest-missing", about: "manifest.yaml" },
    ],
    [
      "a manifest whose id is not the minter's",
      (verifiers: Verifiers) =>
        treeOf({
          "manifest.yaml": MANIFEST.replace(BUNDLE_ID, "acme-2026"),
          "company/answers/support-hours.md": supportHours(verifiers),
        }),
      { file: "manifest.yaml", reason: "manifest-malformed", about: "id" },
    ],
  ])("refuses %s, naming the file and the reason", async (_shape, tree, unsound) => {
    const { scenario, verifiers } = await arranged();

    const refused = await importing(scenario, scenario.editor, { tree: tree(verifiers) });

    expect(refused).toEqual({ ok: false, error: { kind: "unsound", ...unsound } });
    await nothingWritten(scenario);
  });

  it("refuses a Viewer, who may not write to the bundle", async () => {
    const { scenario, verifiers } = await arranged();

    const refused = await importing(scenario, scenario.viewer, { tree: soundBundle(verifiers) });

    expect(refused).toEqual({ ok: false, error: "role-forbids" });
    await nothingWritten(scenario);
  });

  it("refuses a bundle whose workspace already carries a manifest with another id, on a run and on a dry run alike", async () => {
    const { scenario, verifiers } = await arranged();
    const other = await writeManifest(scenario.editor, doorsOf(scenario), {
      manifest: {
        id: "01J6DDDDDDDDDDDDDDDDDDDDDD",
        origin: "company",
        ref: "An earlier bundle",
        owner: "Acme Software Ltd",
        content_version: "2026-08-01",
      },
      message: "Write the bundle's manifest",
      author: { name: "Ada Editor", email: "ada@acme.invalid" },
    });
    if (!other.ok) throw new Error(`the manifest was refused: ${String(other.error)}`);

    const run = await importing(scenario, scenario.editor, { tree: soundBundle(verifiers) });
    const dry = await importing(scenario, scenario.editor, {
      tree: soundBundle(verifiers),
      dryRun: true,
    });

    expect(run).toEqual({ ok: false, error: "manifest-taken" });
    expect(dry).toEqual({ ok: false, error: "manifest-taken" });
    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toHaveLength(1);
    expect(await rowsFor(scenario.workspaceId)).toEqual({
      concepts: "0",
      commits: "1",
      checks: "0",
      events: "1",
    });
  });
});
