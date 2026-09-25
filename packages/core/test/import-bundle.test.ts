import { describe, expect, it } from "vitest";

import { head } from "@better-answers/core/store/git";

import { open, renderOpen } from "../src/answering/index.ts";
import {
  importBundle,
  writeConcept,
  writeManifest,
  type BundleImported,
  type BundleTree,
  type ImportBundleInput,
  type ImportProgress,
  type WriteConceptInput,
} from "../src/concepts/index.ts";
import type { UserPrincipal } from "../src/kernel/index.ts";
import { bundleHistory, commitFacts, fileAtCommit } from "./bundle.ts";
import { addressOf, holdingTable, isBlockedOnTable, readingAs, until } from "./suite-postgres.ts";
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
  readonly sources?: string;
};

const conceptFile = (concept: Concept): string => {
  const entry = concept.entry ?? "ENTRY-001";
  const verified =
    concept.verified === undefined
      ? ""
      : `verified:\n${concept.verified.map((event) => `  - { by: ${event.by}, at: ${event.at} }`).join("\n")}\n`;
  const sources =
    concept.sources ??
    `  - id: ${entry}
    resource: ../sources/Acme_Bid_Library_v1.md
    title: Acme Bid Library v1, entry ${entry}
    last_modified: 2026-03-01
`;
  return `---
type: ${concept.type ?? "Answer"}
title: ${concept.title}
description: One sentence a listing shows.
tags: [${concept.tags ?? "company"}]
generated: { by: claude-code/claude-fable-5-1, at: 2026-09-22T00:30:00Z }
${verified}${concept.frontmatter ?? ""}sources:
${sources}---

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

const irisByPath = async (workspaceId: string): Promise<ReadonlyMap<string, string>> => {
  const found = await db().pool.query<{ path: string; iri: string }>(
    "SELECT path, iri FROM concept_index WHERE workspace_id = $1",
    [workspaceId],
  );
  return new Map(found.rows.map((row) => [row.path, row.iri]));
};

const filesAtHead = async (scenario: Scenario): Promise<ReadonlyMap<string, string>> => {
  const sha = (await bundleHistory(scenario.git, scenario.workspaceId)).at(-1) ?? "";
  const files = new Map<string, string>();
  for (const path of PATHS_IN_ORDER) {
    files.set(path, await fileAtCommit(scenario.git, scenario.workspaceId, sha, path));
  }
  return files;
};

const LINKED = {
  supportHours: "knowledge/company/answers/support-hours.md",
  advancedAnswer: "knowledge/product/answers/can-two-teams-share-one-account-advanced-plan.md",
  standardAnswer: "knowledge/product/answers/can-two-teams-share-one-account-standard-plan.md",
  advancedTier: "knowledge/product/tiers/advanced-plan.md",
  standardTier: "knowledge/product/tiers/standard-plan.md",
} as const;

const REWRITTEN_IN_ORDER = [
  { path: LINKED.supportHours, links: 1 },
  { path: LINKED.advancedAnswer, links: 2 },
  { path: LINKED.standardAnswer, links: 1 },
];

// Stands in for another writer's commit between the passes: the row's hash moves when the
// concept's first check lands, before pass two reads it.
const movedBetweenThePasses = async <T>(path: string, work: () => Promise<T>): Promise<T> => {
  const pool = db().pool;
  await pool.query(
    `CREATE FUNCTION move_between_the_passes() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN
         UPDATE concept_index SET content_hash = repeat('f', 64)
          WHERE workspace_id = NEW.workspace_id AND iri = NEW.iri AND path = '${path}';
         RETURN NEW;
       END $$`,
  );
  await pool.query(
    "CREATE TRIGGER move_between_the_passes AFTER INSERT ON concept_verification FOR EACH ROW EXECUTE FUNCTION move_between_the_passes()",
  );
  try {
    return await work();
  } finally {
    await pool.query("DROP TRIGGER move_between_the_passes ON concept_verification");
    await pool.query("DROP FUNCTION move_between_the_passes()");
  }
};

const standingConcept = (
  scenario: Scenario,
  mergeKey: string,
  overrides: Partial<WriteConceptInput> = {},
) =>
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
    ...overrides,
  });

// Held at the manifest's row, the run has read the standing paths; the writer queues behind it
// on the bundle's lock.
const landedBetweenTheReadAndTheWrite = async (
  scenario: Scenario,
  path: string,
  run: () => ReturnType<typeof importBundle>,
) => {
  let stopped: ReturnType<typeof importBundle> | undefined;
  let landing: ReturnType<typeof writeConcept> | undefined;
  await holdingTable(db().pool, "bundle_commit", async () => {
    stopped = run();
    await until(() => isBlockedOnTable(db().pool, "bundle_commit"));
    landing = standingConcept(scenario, "Answer:landed elsewhere", {
      path,
      title: "Landed elsewhere",
      frontmatter: { title: "Landed elsewhere", type: "Answer" },
      body: "Landed by another writer.",
      message: "Land a concept between the loader's read and its write",
      expects: { base: null },
    });
  });
  const other = await landing;
  if (other === undefined || !other.ok) {
    throw new Error(`the other writer was refused: ${String(other?.error)}`);
  }
  return { stopped: await stopped, other: other.value };
};

const stoppedAt = (file: string, reason: string, progress: ImportProgress) => ({
  ok: false,
  error: { kind: "stopped", file, reason, progress },
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
      rewritten: REWRITTEN_IN_ORDER,
      concepts: 6,
      dryRun: false,
    });
    const history = await bundleHistory(scenario.git, scenario.workspaceId);
    expect(history).toHaveLength(10);
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
      "manifest concept check check concept check concept check concept check concept check concept check concept concept concept",
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

  it("skips what already landed on a rerun, records no second check for the same actor and instant, rewrites no link, and says so", async () => {
    const { scenario, verifiers } = await arranged();
    await imported(scenario, soundBundle(verifiers));

    const again = await imported(scenario, soundBundle(verifiers));
    const dry = await imported(scenario, soundBundle(verifiers), { dryRun: true });

    expect(again).toEqual({
      bundleId: BUNDLE_ID,
      manifest: "standing",
      landed: [],
      skipped: PATHS_IN_ORDER,
      checks: { recorded: 0, present: 7 },
      rewritten: [],
      concepts: 6,
      dryRun: false,
    });
    expect(dry.rewritten).toEqual([]);
    expect(dry.manifest).toBe("standing");
    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toHaveLength(10);
    expect(await rowsFor(scenario.workspaceId)).toEqual({
      concepts: "6",
      commits: "10",
      checks: "7",
      events: "17",
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

    expect(stopped).toEqual(
      stoppedAt(
        "product/answers/can-two-teams-share-one-account-advanced-plan.md",
        "merge-key-taken",
        {
          landed: [
            "knowledge/company/answers/data-retention-period.md",
            "knowledge/company/answers/support-hours.md",
          ],
          skipped: [],
          checks: { recorded: 3, present: 0 },
          rewritten: [],
        },
      ),
    );
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
      rewritten: REWRITTEN_IN_ORDER,
      concepts: 6,
      dryRun: false,
    });
    expect(await checkRows(scenario.workspaceId)).toHaveLength(7);
  });

  it("stops at the concept whose path another writer landed between the loader's read and its write, naming the file, with the head and the recorded commits where the refusal found them, and skips it on a rerun", async () => {
    const { scenario, verifiers } = await arranged();

    const { stopped, other } = await landedBetweenTheReadAndTheWrite(
      scenario,
      LINKED.supportHours,
      () => importing(scenario, scenario.editor, { tree: soundBundle(verifiers) }),
    );

    expect(stopped).toEqual(
      stoppedAt("company/answers/support-hours.md", "path-taken", {
        landed: ["knowledge/company/answers/data-retention-period.md"],
        skipped: [],
        checks: { recorded: 2, present: 0 },
        rewritten: [],
      }),
    );
    const history = await bundleHistory(scenario.git, scenario.workspaceId);
    expect(history).toHaveLength(3);
    expect(history[1]).toBe(other.sha);
    expect(await head(scenario.editor, scenario.git)).toBe(history[2]);
    expect(await rowsFor(scenario.workspaceId)).toEqual({
      concepts: "2",
      commits: "3",
      checks: "2",
      events: "5",
    });

    const completed = await imported(scenario, soundBundle(verifiers));

    expect(completed).toMatchObject({
      landed: [
        LINKED.advancedAnswer,
        LINKED.standardAnswer,
        LINKED.advancedTier,
        LINKED.standardTier,
      ],
      skipped: ["knowledge/company/answers/data-retention-period.md", LINKED.supportHours],
    });
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
      rewritten: REWRITTEN_IN_ORDER,
      concepts: 6,
      dryRun: true,
    });
    await nothingWritten(scenario);
  });

  it("lands every concept at the class the caller names, an Admin landing them Restricted and reading them back for the second pass", async () => {
    const { scenario, verifiers } = await arranged();

    const run = await importing(scenario, scenario.admin, {
      tree: soundBundle(verifiers),
      sensitivity: "Restricted",
    });

    if (!run.ok) throw new Error(`the import was refused: ${JSON.stringify(run.error)}`);
    expect(run.value.rewritten).toEqual(REWRITTEN_IN_ORDER);
    expect(
      new Set((await indexRows(scenario.workspaceId)).map((row) => row["sensitivity"])),
    ).toEqual(new Set(["Restricted"]));
  });
});

describe("the second pass: every relative link becomes the iri of the concept it names", () => {
  it("rewrites each link's target to the iri, its text untouched, as a governed write on top of pass one, and says which files it rewrote", async () => {
    const { scenario, verifiers } = await arranged();

    const run = await imported(scenario, soundBundle(verifiers));

    expect(run.rewritten).toEqual(REWRITTEN_IN_ORDER);
    const iri = await irisByPath(scenario.workspaceId);
    const files = await filesAtHead(scenario);
    expect(files.get(LINKED.supportHours)).toContain(
      `Support answers between 08:00 and 18:00 on working days. [Advanced plan](${iri.get(LINKED.advancedTier)}) customers reach an engineer out of hours.`,
    );
    expect(files.get(LINKED.advancedAnswer)).toContain(
      `The [Standard plan's answer](${iri.get(LINKED.standardAnswer)}) is the looser default.\n\nThis answer is for the [Advanced plan](${iri.get(LINKED.advancedTier)}).`,
    );
    expect(files.get(LINKED.standardAnswer)).toContain(
      `This answer is for the [Standard plan](${iri.get(LINKED.standardTier)}).`,
    );
    for (const file of files.values()) {
      expect(file).not.toMatch(/\]\([^)]*\.md/);
      expect(file).not.toContain("@");
    }
    const history = await bundleHistory(scenario.git, scenario.workspaceId);
    expect(history).toHaveLength(10);
    const rewrite = await commitFacts(scenario.git, scenario.workspaceId, history[7] ?? "");
    expect({
      subject: rewrite.subject,
      author: rewrite.author,
      actor: rewrite.trailers["Actor"],
    }).toEqual({
      subject:
        "Rewrite the links in knowledge/company/answers/support-hours.md to the iris of the concepts they name",
      author: await authorOf(scenario.editor),
      actor: `human:${scenario.editor.userId}`,
    });
    expect((await ledgerOf(scenario.workspaceId)).slice(-3).map((row) => row["act"])).toEqual([
      "knowledge.concept.committed",
      "knowledge.concept.committed",
      "knowledge.concept.committed",
    ]);
    const edges = await db().pool.query<{ from_uid: string; to_uid: string }>(
      `SELECT from_uid, to_uid FROM graph_edge
        WHERE workspace_id = $1 AND label = 'LINKS_TO' ORDER BY from_uid, uid`,
      [scenario.workspaceId],
    );
    const linked: readonly (readonly [string, string])[] = [
      [LINKED.supportHours, LINKED.advancedTier],
      [LINKED.advancedAnswer, LINKED.standardAnswer],
      [LINKED.advancedAnswer, LINKED.advancedTier],
      [LINKED.standardAnswer, LINKED.standardTier],
    ];
    expect(edges.rows).toEqual(
      linked
        .map(([from, to]) => ({ from_uid: iri.get(from), to_uid: iri.get(to) }))
        .toSorted((one, other) => (one.from_uid ?? "").localeCompare(other.from_uid ?? "")),
    );
  });

  it("stops at the file whose concept moved between the passes, naming it, rewrites nothing after it, and rewrites it on a rerun", async () => {
    const { scenario, verifiers } = await arranged();

    const stopped = await movedBetweenThePasses(LINKED.supportHours, () =>
      importing(scenario, scenario.editor, { tree: soundBundle(verifiers) }),
    );

    expect(stopped).toEqual(
      stoppedAt("company/answers/support-hours.md", "stale-precondition", {
        landed: PATHS_IN_ORDER,
        skipped: [],
        checks: { recorded: 7, present: 0 },
        rewritten: [],
      }),
    );
    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toHaveLength(7);
    const files = await filesAtHead(scenario);
    for (const { path } of REWRITTEN_IN_ORDER) expect(files.get(path)).toMatch(/\]\([^)]*\.md\)/);

    const completed = await imported(scenario, soundBundle(verifiers));

    expect(completed.rewritten).toEqual(REWRITTEN_IN_ORDER);
    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toHaveLength(10);
    for (const file of (await filesAtHead(scenario)).values()) {
      expect(file).not.toMatch(/\]\([^)]*\.md/);
    }
  });
});

describe("an imported concept, opened", () => {
  it("renders the locator after a source that carries one, and no parenthesis after a source that carries none", async () => {
    const { scenario, verifiers } = await arranged();
    await imported(
      scenario,
      treeOf({
        "manifest.yaml": MANIFEST,
        "company/answers/support-hours.md": conceptFile({
          title: "Support hours",
          verified: [{ by: humanOf(verifiers.mona), at: CHECKED_AT }],
          sources: [
            "  - id: ENTRY-001",
            "    resource: ../sources/Acme_Bid_Library_v1.md",
            "    title: Acme Bid Library v1, entry ENTRY-001",
            "    locator: p.4",
            "  - id: PROD-005",
            "    resource: ../sources/Acme_Product_Library_v2.md",
            "    title: Acme Product Library v2, entry PROD-005",
            "",
          ].join("\n"),
          body: "Support answers between 08:00 and 18:00 on working days.",
        }),
      }),
    );
    const iri = (await irisByPath(scenario.workspaceId)).get(LINKED.supportHours) ?? "";

    const opened = await readingAs(db().runtimePool, scenario.viewer, (principal, tx) =>
      open(principal, tx, { iri }, new Date("2026-09-22T10:00:00.000Z")),
    );

    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(renderOpen(opened.value).split("\n").slice(-3)).toEqual([
      "Evidence:",
      "- Acme Bid Library v1, entry ENTRY-001 (p.4)",
      "- Acme Product Library v2, entry PROD-005",
    ]);
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

  it("refuses an Editor asked to land the bundle Restricted, a class only an Admin could read back for the second pass", async () => {
    const { scenario, verifiers } = await arranged();

    const refused = await importing(scenario, scenario.editor, {
      tree: soundBundle(verifiers),
      sensitivity: "Restricted",
    });

    expect(refused).toEqual({ ok: false, error: "class-unreadable" });
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
