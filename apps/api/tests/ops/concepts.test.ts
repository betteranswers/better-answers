import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assert, describe, expect, it } from "vitest";

import { find, open, trustWords } from "@better-answers/core/answering";
import { writeConcept, writeManifest } from "@better-answers/core/concepts";
import type { UserPrincipal } from "@better-answers/core/kernel";
import { fileAtHead, head, initRepository } from "@better-answers/core/store/git";
import {
  folded,
  withPrincipal,
  type Answered,
  type Foldable,
  type Tx,
} from "@better-answers/core/store/postgres";
import { divergeHistory, holdMainRef } from "@better-answers/core/testing/bundle";
import { objectStoreForSuite } from "@better-answers/core/testing/objects";
import { ids, type ConceptIri } from "@better-answers/schema";
import { matching } from "@better-answers/schema/testing/matching";

import { EXIT_OF_CLASS } from "../../src/ops/index.ts";
import { readTreeUnder } from "../../src/ops/read-tree.ts";
import { connectAsHost } from "../support/flow.ts";
import { doorsFor, openTestGit, type TestApp } from "../support/harness/harness.ts";
import { calledTool, rendered, rpcOf, structured } from "../support/mcp-call.ts";
import {
  opsRunner,
  type Run,
  idOnTheDoneLine,
  aShortName,
  principalOf,
} from "../support/ops-run.ts";
import { servedApp } from "../support/suite-app.ts";

const objects = objectStoreForSuite();
const { ops, opsWith, provisioning, adding } = opsRunner(objects);

const bundleDoors = (app: TestApp) => ({
  git: openTestGit(app),
  postgres: app.doors.postgres,
  clock: app.doors.clock,
});

type Provisioned = Awaited<ReturnType<TestApp["provision"]>>;

const replayedAfterTheWindow = async (
  app: TestApp,
  write: (
    principal: UserPrincipal,
    doors: ReturnType<typeof bundleDoors>,
    admin: Provisioned["admin"],
  ) => Promise<{ readonly ok: boolean }>,
) => {
  const { workspaceId, admin } = await app.provision();
  const git = openTestGit(app);
  await initRepository(git, workspaceId);
  const principal = await principalOf(app, workspaceId, admin.id);
  await lostInTheWindow(app, () => write(principal, bundleDoors(app), admin));
  const sha = await head(principal, git);

  const run = await ops(app, ["reconcile-watermark", "--workspace", workspaceId]);

  expect(run.exitCode).toBe(0);
  expect(run.lines).toEqual([
    `reconcile-watermark: done — head ${sha}, watermark none, replayed 1, already landed 0`,
  ]);
  return { workspaceId, admin, sha };
};

const restoreDrillNote = (
  principal: UserPrincipal,
  doors: ReturnType<typeof bundleDoors>,
  admin: Provisioned["admin"],
) =>
  writeConcept(principal, doors, {
    mergeKey: "note:restore-drill",
    path: "knowledge/restore-drill.md",
    kind: "Note",
    title: "Restore drill",
    frontmatter: { title: "Restore drill", type: "Note" },
    body: "The rows are behind the bundle until the reconciler runs.",
    message: "Record the restore drill note",
    author: { name: admin.name, email: admin.email },
    expects: { head: null },
    status: "stable",
  });

const lostInTheWindow = async (
  app: TestApp,
  action: () => Promise<{ readonly ok: boolean }>,
): Promise<void> => {
  const superuser = app.database.superuser;
  await superuser.query(
    `CREATE FUNCTION crash_in_the_window() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN RAISE EXCEPTION 'the process died between the commit and its rows'; END $$`,
  );
  await superuser.query(
    "CREATE TRIGGER crash_in_the_window BEFORE INSERT ON bundle_commit FOR EACH ROW EXECUTE FUNCTION crash_in_the_window()",
  );
  try {
    expect((await action()).ok).toBe(false);
  } finally {
    await superuser.query("DROP TRIGGER crash_in_the_window ON bundle_commit");
    await superuser.query("DROP FUNCTION crash_in_the_window()");
  }
};

describe("pnpm ops — the restore scripts' commands", () => {
  const served = servedApp();

  describe("reconcile-watermark — the reconciler on demand, the restore's path", () => {
    it("refuses without a repositories' root, having no bundle to reconcile", async () => {
      const { workspaceId } = await served().provision();

      const run = await opsWith(
        served(),
        ["reconcile-watermark", "--workspace", workspaceId],
        { doors: { git: undefined } },
        served().database.superuser,
      );

      expect(run.exitCode).toBe(1);
      expect(run.lines).toEqual([
        "reconcile-watermark: REFUSED — no repositories' root is configured (GIT_STORE_DIR), so the bundle cannot be opened; the estate sets it to /data/git on the api service",
      ]);
    });

    it("refuses a missing repositories' root directory, naming it", async () => {
      const { workspaceId } = await served().provision();
      const missing = `${served().gitStoreDir}/does-not-exist`;

      const run = await opsWith(
        served(),
        ["reconcile-watermark", "--workspace", workspaceId],
        { doors: doorsFor(served().database.superuser, { gitStoreDir: missing }) },
        served().database.superuser,
      );

      expect(run.exitCode).toBe(1);
      expect(run.lines).toEqual([
        `reconcile-watermark: REFUSED — the repositories' root is no-such-root (GIT_STORE_DIR=${missing})`,
      ]);
    });

    it("answers usage to a non-id workspace before opening anything", async () => {
      const run = await ops(served(), ["reconcile-watermark", "--workspace", "ws_synthetic"]);

      expect(run.exitCode).toBe(2);
    });

    it("refuses a missing repository, which means an unrestored store", async () => {
      const { workspaceId } = await served().provision();

      const run = await ops(served(), ["reconcile-watermark", "--workspace", workspaceId]);

      expect(run.exitCode).toBe(EXIT_OF_CLASS.precondition);
      expect(run.lines).toEqual(["reconcile-watermark: REFUSED — no-such-repository"]);
    });

    it("exits 0 when rows and bundle agree, reporting its findings", async () => {
      const { workspaceId } = await served().provision();
      await initRepository(openTestGit(served()), workspaceId);

      const run = await ops(served(), ["reconcile-watermark", "--workspace", workspaceId]);

      expect(run.exitCode).toBe(0);
      expect(run.lines).toEqual([
        "reconcile-watermark: done — head none, watermark none, replayed 0, already landed 0",
      ]);
    });

    it("replays a missed commit and lands its concept's row", async () => {
      const { workspaceId, sha } = await replayedAfterTheWindow(served(), restoreDrillNote);

      const landed = await served().database.superuser.query<{ path: string; commit_sha: string }>(
        "SELECT path, commit_sha FROM concept_index WHERE workspace_id = $1",
        [workspaceId],
      );
      expect(landed.rows).toEqual([{ path: "knowledge/restore-drill.md", commit_sha: sha }]);
    });

    it("refuses a diverged history, exiting as a precondition", async () => {
      const { workspaceId } = await replayedAfterTheWindow(served(), restoreDrillNote);
      await divergeHistory(openTestGit(served()), workspaceId);

      const run = await ops(served(), ["reconcile-watermark", "--workspace", workspaceId]);

      expect(run.exitCode).toBe(EXIT_OF_CLASS.precondition);
      expect(run.lines).toEqual(["reconcile-watermark: REFUSED — history-diverged"]);
    });

    it("replays a missed manifest commit, landing its row, no concept", async () => {
      const { workspaceId, admin, sha } = await replayedAfterTheWindow(
        served(),
        (principal, doors, author) =>
          writeManifest(principal, doors, {
            manifest: {
              id: "01J6BBBBBBBBBBBBBBBBBBBBBB",
              origin: "company",
              ref: "Four bid libraries, reviewed 22 September 2026",
              owner: "Acme",
              content_version: "2026-09-22",
            },
            message: "Write the bundle's manifest",
            author: { name: author.name, email: author.email },
          }),
      );

      const rows = await served().database.superuser.query<Record<string, unknown>>(
        `SELECT c.sha, c.parent_sha, c.actor, e.action, e.detail,
                (SELECT count(*)::int FROM concept_index i WHERE i.workspace_id = c.workspace_id) AS concepts
           FROM bundle_commit c
           JOIN audit_event e ON e.workspace_id = c.workspace_id AND e.id = c.audit_event_id
          WHERE c.workspace_id = $1`,
        [workspaceId],
      );
      expect(rows.rows).toEqual([
        {
          sha,
          parent_sha: null,
          actor: `human:${admin.id}`,
          action: "platform.reconciler.replayed",
          detail: { commitSha: sha, bundleId: "01J6BBBBBBBBBBBBBBBBBBBBBB" },
          concepts: 0,
        },
      ]);
    });
  });

  describe("import-bundle — the company's bundle landed through the governed write", () => {
    const BUNDLE_FIXTURE = fileURLToPath(new URL("../fixtures/bundle", import.meta.url));
    const BUNDLE_ID = "01J6CCCCCCCCCCCCCCCCCCCCCC";
    const IMPORTED_AT = new Date("2026-09-22T10:00:00.000Z");
    const MONA = "mona.reviewer@acme.invalid";
    const THEO = "theo.approver@acme.invalid";
    const IMPORTED_PATHS = [
      "knowledge/company/answers/data-retention-period.md",
      "knowledge/company/answers/support-hours.md",
      "knowledge/product/answers/can-two-teams-share-one-account-advanced-plan.md",
      "knowledge/product/answers/can-two-teams-share-one-account-standard-plan.md",
      "knowledge/product/tiers/advanced-plan.md",
      "knowledge/product/tiers/standard-plan.md",
    ] as const;

    const verifierIds = new Map<string, string>();

    const verifierOf = async (app: TestApp, email: string, name: string): Promise<string> => {
      const known = verifierIds.get(email);
      if (known !== undefined) return known;
      const { id } = await app.person(email, name);
      verifierIds.set(email, id);
      return id;
    };

    const bundleWorkspace = async (app: TestApp, { repository = true } = {}) => {
      const { workspaceId, admin } = await app.provision();
      if (repository) await initRepository(openTestGit(app), workspaceId);
      const mona = await verifierOf(app, MONA, "Mona Reviewer");
      const theo = await verifierOf(app, THEO, "Theo Approver");
      await app.addMember(workspaceId, mona, "Editor");
      await app.addMember(workspaceId, theo, "Editor");
      return { workspaceId, admin, mona, theo };
    };

    const importing = (
      app: TestApp,
      workspaceId: string,
      email: string,
      {
        flags = [],
        from = BUNDLE_FIXTURE,
      }: { readonly flags?: readonly string[]; readonly from?: string } = {},
    ): Promise<Run> =>
      opsWith(
        app,
        ["import-bundle", "--workspace", workspaceId, "--from", from, "--as", email, ...flags],
        { io: { readTree: readTreeUnder }, doors: { clock: { now: () => IMPORTED_AT } } },
      );

    const reading = async <T>(
      app: TestApp,
      workspaceId: string,
      userId: string,
      work: (principal: UserPrincipal, tx: Tx) => Promise<Foldable<T>>,
    ): Promise<Answered<T>> => {
      const read = folded<T>(
        await withPrincipal(
          app.doors.postgres,
          { workspaceId, userId, issuedAt: new Date() },
          work,
        ),
      );
      if (!read.ok) throw new Error(`the read answered ${String(read.error)}`);
      return read.value;
    };

    const commitsOf = async (app: TestApp, workspaceId: string) => {
      const found = await app.database.superuser.query<Record<string, unknown>>(
        `SELECT c.sha, c.parent_sha, e.action
           FROM bundle_commit c
           JOIN audit_event e ON e.workspace_id = c.workspace_id AND e.id = c.audit_event_id
          WHERE c.workspace_id = $1
          ORDER BY c.committed_at, c.sha`,
        [workspaceId],
      );
      return found.rows;
    };

    type IndexRow = {
      readonly iri: string;
      readonly path: string;
      readonly kind: string;
      readonly title: string;
      readonly status: string;
      readonly sensitivity: string;
    };

    const indexRowsOf = async (app: TestApp, workspaceId: string) => {
      const found = await app.database.superuser.query<IndexRow>(
        `SELECT iri, path, kind, title, status, sensitivity
           FROM concept_index WHERE workspace_id = $1 ORDER BY path`,
        [workspaceId],
      );
      return found.rows;
    };

    const iriOf = async (
      app: TestApp,
      workspaceId: string,
      conceptPath: string,
    ): Promise<ConceptIri> => {
      const row = (await indexRowsOf(app, workspaceId)).find((each) => each.path === conceptPath);
      if (row === undefined) throw new Error(`no concept stands at ${conceptPath}`);
      return ids.conceptIri.parse(row.iri);
    };

    const REWRITTEN_LINES = [
      "import-bundle: rewrote knowledge/company/answers/support-hours.md — 1 link",
      "import-bundle: rewrote knowledge/product/answers/can-two-teams-share-one-account-advanced-plan.md — 2 links",
      "import-bundle: rewrote knowledge/product/answers/can-two-teams-share-one-account-standard-plan.md — 1 link",
    ];

    const verificationRowsOf = async (app: TestApp, workspaceId: string) => {
      const found = await app.database.superuser.query<Record<string, unknown>>(
        `SELECT c.path, v.actor, v.verified_at, v.content_hash, v.origin
           FROM concept_verification v
           JOIN concept_index c ON c.workspace_id = v.workspace_id AND c.iri = v.iri
          WHERE v.workspace_id = $1
          ORDER BY c.path, v.verified_at`,
        [workspaceId],
      );
      return found.rows;
    };

    const actionsOf = async (app: TestApp, workspaceId: string) => {
      const found = await app.database.superuser.query<{ action: string; events: number }>(
        `SELECT action, count(*)::int AS events FROM audit_event
          WHERE workspace_id = $1 AND action LIKE 'knowledge.%'
          GROUP BY action ORDER BY action`,
        [workspaceId],
      );
      return found.rows;
    };

    const filesAtHead = async (app: TestApp, workspaceId: string, userId: string) => {
      const principal = await principalOf(app, workspaceId, userId);
      const git = openTestGit(app);
      const files = new Map<string, string | null>();
      for (const file of ["knowledge/manifest.yaml", ...IMPORTED_PATHS]) {
        files.set(file, await fileAtHead(principal, git, file));
      }
      return files;
    };

    it("lands the fixture, saying each concept, then each rewritten file", async () => {
      const { workspaceId, admin } = await bundleWorkspace(served());

      const run = await importing(served(), workspaceId, admin.email);

      expect(run.exitCode).toBe(0);
      expect(run.lines).toEqual([
        `import-bundle: manifest ${BUNDLE_ID} written as the bundle's first commit`,
        ...IMPORTED_PATHS.map((file) => `import-bundle: landed ${file}`),
        ...REWRITTEN_LINES,
        "import-bundle: done — landed 6, skipped 0, 7 verifications recorded (0 already present), 4 links rewritten, 0.0 seconds",
      ]);
    });

    it("commits the manifest first, then each concept, landing their rows", async () => {
      const { workspaceId, admin } = await bundleWorkspace(served());

      await importing(served(), workspaceId, admin.email);

      const commits = await commitsOf(served(), workspaceId);
      expect(commits).toHaveLength(10);
      expect(commits[0]).toEqual({
        sha: matching.any(String),
        parent_sha: null,
        action: "knowledge.manifest.written",
      });
      expect(commits.slice(1).map((row) => [row["action"], row["parent_sha"]])).toEqual(
        commits.slice(0, -1).map((row) => ["knowledge.concept.committed", row["sha"]]),
      );
      const rows = await indexRowsOf(served(), workspaceId);
      expect(rows.map((row) => row.path)).toEqual(IMPORTED_PATHS);
      expect(rows.map((row) => `${row.kind}: ${row.title}`)).toEqual([
        "Answer: Data retention period",
        "Answer: Support hours",
        "Answer: Can two teams share one account? (Advanced plan)",
        "Answer: Can two teams share one account? (Standard plan)",
        "Tier: Advanced plan",
        "Tier: Standard plan",
      ]);
      expect(new Set(rows.map((row) => `${row.status} ${row.sensitivity}`))).toEqual(
        new Set(["stable Internal"]),
      );
    });

    it("normalises the manifest, rewrites links as IRIs, leaves no email", async () => {
      const { workspaceId, admin, mona } = await bundleWorkspace(served());

      await importing(served(), workspaceId, admin.email);

      const files = await filesAtHead(served(), workspaceId, admin.id);
      expect(files.get("knowledge/manifest.yaml")).toBe(
        [
          `"id": "${BUNDLE_ID}"`,
          '"origin": "company"',
          '"ref": "Two answer libraries, reviewed 22 September 2026"',
          '"owner": "Acme Software Ltd"',
          '"content_version": "2026-09-22"',
          "",
        ].join("\n"),
      );
      for (const file of IMPORTED_PATHS) {
        expect(files.get(file)).not.toContain("@");
        expect(files.get(file)).not.toMatch(/\]\([^)]*\.md/);
        expect(files.get(file)).toContain(`"by": "human:${mona}"`);
      }
      expect(files.get("knowledge/company/answers/support-hours.md")).toContain(
        `[Advanced plan](${await iriOf(served(), workspaceId, "knowledge/product/tiers/advanced-plan.md")}) customers reach an engineer out of hours`,
      );
      expect(
        files.get("knowledge/product/answers/can-two-teams-share-one-account-advanced-plan.md"),
      ).toContain(
        `The [Standard plan's answer](${await iriOf(served(), workspaceId, "knowledge/product/answers/can-two-teams-share-one-account-standard-plan.md")}) describes the looser default`,
      );
    });

    it("open follows a rewritten link to the concept it names", async () => {
      const { workspaceId, admin } = await bundleWorkspace(served());
      await importing(served(), workspaceId, admin.email);
      const opening = (iri: ConceptIri) =>
        reading(served(), workspaceId, admin.id, (principal, tx) =>
          open(principal, tx, { iri }, IMPORTED_AT),
        );

      const from = await opening(
        await iriOf(served(), workspaceId, "knowledge/company/answers/support-hours.md"),
      );
      assert(from.found, "the linking concept did not open");
      assert(from.concept !== undefined, "the linking concept did not open");
      const link = /\]\((https:\/\/[^)]+)\)/.exec(from.concept.body);
      assert(link !== null, "the concept links to another");
      const to = await opening(ids.conceptIri.parse(link[1]));

      assert(to.found, `nothing stands at ${String(link[1])}`);
      expect(to.concept?.frontmatter["title"]).toBe("Advanced plan");
    });

    it("imports verified events as checks that find and open show", async () => {
      const { workspaceId, admin, mona, theo } = await bundleWorkspace(served());

      await importing(served(), workspaceId, admin.email);

      const verifications = await verificationRowsOf(served(), workspaceId);
      expect(verifications).toHaveLength(7);
      expect(verifications.slice(0, 3)).toEqual([
        {
          path: "knowledge/company/answers/data-retention-period.md",
          actor: `human:${mona}`,
          verified_at: new Date("2026-04-16T00:00:00.000Z"),
          content_hash: null,
          origin: "imported",
        },
        {
          path: "knowledge/company/answers/data-retention-period.md",
          actor: `human:${theo}`,
          verified_at: new Date("2026-06-01T09:30:00.000Z"),
          content_hash: null,
          origin: "imported",
        },
        {
          path: "knowledge/company/answers/support-hours.md",
          actor: `human:${mona}`,
          verified_at: new Date("2026-04-16T00:00:00.000Z"),
          content_hash: null,
          origin: "imported",
        },
      ]);
      expect(await actionsOf(served(), workspaceId)).toEqual([
        { action: "knowledge.check.imported", events: 7 },
        { action: "knowledge.concept.committed", events: 9 },
        { action: "knowledge.manifest.written", events: 1 },
      ]);

      const found = await reading(served(), workspaceId, admin.id, (principal, tx) =>
        find(principal, tx, { query: "retention", limit: 10 }, IMPORTED_AT),
      );
      const [match, ...rest] = found.matches;
      expect(rest).toEqual([]);
      assert(match?.layer === "bundles", "the match is not a concept");
      expect({
        kind: match.kind,
        title: match.title,
        tags: match.tags,
        words: trustWords(match.trust),
      }).toEqual({
        kind: "Answer",
        title: "Data retention period",
        tags: ["company", "data-protection", "g-cloud-15"],
        words: "Verified by Theo Approver · 1 June 2026 · imported",
      });

      const opened = await reading(served(), workspaceId, admin.id, (principal, tx) =>
        open(principal, tx, { iri: match.iri }, IMPORTED_AT),
      );
      assert(opened.found, "the concept was not found");
      expect(opened.concept?.trust).toEqual({
        tier: "human-reviewed",
        status: "current",
        verifiedBy: "Theo Approver",
        verifiedAt: "2026-06-01T09:30:00.000Z",
        rider: "imported",
      });
      expect(opened.concept?.frontmatter["verified"]).toEqual([
        { by: `human:${mona}`, at: "2026-04-16T00:00:00Z" },
        { by: `human:${theo}`, at: "2026-06-01T09:30:00Z" },
      ]);
    });

    const SUPPORT_HOURS = "Support answers between 08:00 and 18:00 on working days.";

    const TWO_SOURCES = [
      "  - id: ENTRY-001",
      "    resource: ../sources/Acme_Bid_Library_v1.md",
      "    title: Acme Bid Library v1, entry ENTRY-001",
      "    locator: p.4",
      "  - id: PROD-005",
      "    resource: ../sources/Acme_Product_Library_v2.md",
      "    title: Acme Product Library v2, entry PROD-005",
    ];

    const openedOverMcp = async (sources: readonly string[], body = SUPPORT_HOURS) => {
      const { workspaceId, admin } = await bundleWorkspace(served());
      const from = await mkdtemp(path.join(tmpdir(), "bundle-"));
      await mkdir(path.join(from, "company", "answers"), { recursive: true });
      await writeFile(
        path.join(from, "manifest.yaml"),
        await readFile(path.join(BUNDLE_FIXTURE, "manifest.yaml")),
      );
      await writeFile(
        path.join(from, "company", "answers", "support-hours.md"),
        [
          "---",
          "type: Answer",
          "title: Support hours",
          `description: ${SUPPORT_HOURS}`,
          "tags: [company, support]",
          "verified:",
          `  - { by: human:${MONA}, at: 2026-04-16T00:00:00Z }`,
          "sources:",
          ...sources,
          "---",
          "",
          body,
          "",
        ].join("\n"),
      );
      await importing(served(), workspaceId, admin.email, { from });
      const iri = await iriOf(served(), workspaceId, "knowledge/company/answers/support-hours.md");
      const { accessToken } = await connectAsHost(served(), served().client(), admin, {
        scope: "knowledge:read offline_access",
      });
      return calledTool(served().client(), accessToken, "open", { iri });
    };

    it("renders imported evidence over MCP, a page as its place", async () => {
      const opened = await openedOverMcp(TWO_SOURCES);

      expect(rendered(opened).split("\n").slice(-3)).toEqual([
        "Evidence:",
        "- Acme Bid Library v1, entry ENTRY-001, p.4",
        "- Acme Product Library v2, entry PROD-005",
      ]);
    });

    it("answers no locator over MCP for none or only spaces", async () => {
      const opened = await openedOverMcp([
        ...TWO_SOURCES,
        "  - id: PROD-006",
        "    resource: ../sources/Acme_Product_Library_v2.md",
        "    title: Acme Product Library v2, entry PROD-006",
        '    locator: "   "',
      ]);

      expect(rpcOf(structured(opened)["concept"])["evidence"]).toStrictEqual([
        { id: "ENTRY-001", source: "Acme Bid Library v1, entry ENTRY-001", at: "p.4" },
        { id: "PROD-005", source: "Acme Product Library v2, entry PROD-005" },
        { id: "PROD-006", source: "Acme Product Library v2, entry PROD-006" },
      ]);
      expect(rendered(opened).split("\n").slice(-4)).toEqual([
        "Evidence:",
        "- Acme Bid Library v1, entry ENTRY-001, p.4",
        "- Acme Product Library v2, entry PROD-005",
        "- Acme Product Library v2, entry PROD-006",
      ]);
    });

    it("renders a newline-ended body over MCP without an extra blank", async () => {
      const opened = await openedOverMcp(TWO_SOURCES, `${SUPPORT_HOURS}\n`);

      expect(rendered(opened).split("\n").slice(0, 5)).toEqual([
        "# Support hours",
        "",
        SUPPORT_HOURS,
        "",
        "_Verified by Mona Reviewer · 16 April 2026 · imported_",
      ]);
    });

    it("skips what already landed on a rerun, and says so", async () => {
      const { workspaceId, admin } = await bundleWorkspace(served());
      await importing(served(), workspaceId, admin.email);

      const again = await importing(served(), workspaceId, admin.email);

      expect(again.exitCode).toBe(0);
      expect(again.lines).toEqual([
        `import-bundle: manifest ${BUNDLE_ID} already stands`,
        ...IMPORTED_PATHS.map((file) => `import-bundle: skipped ${file} — already landed`),
        "import-bundle: done — landed 0, skipped 6, 0 verifications recorded (7 already present), 0 links rewritten, 0.0 seconds",
      ]);
      expect(await commitsOf(served(), workspaceId)).toHaveLength(10);
      expect(await verificationRowsOf(served(), workspaceId)).toHaveLength(7);
    });

    it("leaves the watermark at the head, with nothing to replay", async () => {
      const { workspaceId, admin } = await bundleWorkspace(served());
      await importing(served(), workspaceId, admin.email);
      const sha = await head(
        await principalOf(served(), workspaceId, admin.id),
        openTestGit(served()),
      );

      const run = await ops(served(), ["reconcile-watermark", "--workspace", workspaceId]);

      expect(run.exitCode).toBe(0);
      expect(run.lines).toEqual([
        `reconcile-watermark: done — head ${sha}, watermark ${sha}, replayed 0, already landed 0`,
      ]);
    });

    it("reports what a dry run would do, writing nothing", async () => {
      const { workspaceId, admin } = await bundleWorkspace(served());

      const run = await importing(served(), workspaceId, admin.email, { flags: ["--dry-run"] });

      expect(run.exitCode).toBe(0);
      expect(run.lines).toEqual([
        `import-bundle: dry run — the tree is sound: 6 concepts, of which 6 would land and 0 already stand; 7 verifications would be recorded (0 already present); 4 links in 3 concepts would be rewritten; manifest ${BUNDLE_ID} would be written first; nothing was written`,
      ]);
      expect(await commitsOf(served(), workspaceId)).toEqual([]);
      expect(await indexRowsOf(served(), workspaceId)).toEqual([]);
    });

    it("lands the bundle at the class the flag names", async () => {
      const { workspaceId, admin } = await bundleWorkspace(served());

      const run = await importing(served(), workspaceId, admin.email, {
        flags: ["--sensitivity", "Restricted"],
      });

      expect(run.exitCode).toBe(0);
      expect(
        new Set((await indexRowsOf(served(), workspaceId)).map((row) => row.sensitivity)),
      ).toEqual(new Set(["Restricted"]));
    });

    it("refuses to run as a Viewer, and writes nothing", async () => {
      const { workspaceId } = await bundleWorkspace(served());
      const viewer = await served().person();
      await served().addMember(workspaceId, viewer.id, "Viewer");

      const run = await importing(served(), workspaceId, viewer.email);

      expect(run.exitCode).toBe(EXIT_OF_CLASS.forbidden);
      expect(run.lines).toEqual([
        `import-bundle: REFUSED — ${viewer.email} is not an Admin of this workspace; the import runs as an Admin`,
      ]);
      expect(await commitsOf(served(), workspaceId)).toEqual([]);
    });

    it("refuses to run as an Editor, and writes nothing", async () => {
      const { workspaceId } = await bundleWorkspace(served());

      const run = await importing(served(), workspaceId, MONA);

      expect(run.exitCode).toBe(EXIT_OF_CLASS.forbidden);
      expect(run.lines).toEqual([
        `import-bundle: REFUSED — ${MONA} is not an Admin of this workspace; the import runs as an Admin`,
      ]);
      expect(await commitsOf(served(), workspaceId)).toEqual([]);
    });

    it("refuses a workspace with no bundle repository as a precondition", async () => {
      const { workspaceId, admin } = await bundleWorkspace(served(), { repository: false });

      const run = await importing(served(), workspaceId, admin.email);

      expect(run.exitCode).toBe(EXIT_OF_CLASS.precondition);
      expect(run.lines).toEqual([
        "import-bundle: REFUSED — this workspace has no bundle repository; provision it first",
      ]);
    });

    it("exits as a conflict when another writer holds the bundle", async () => {
      const { workspaceId, admin } = await bundleWorkspace(served());
      const release = await holdMainRef(openTestGit(served()), workspaceId);

      const run = await importing(served(), workspaceId, admin.email);
      await release();

      expect(run.exitCode).toBe(EXIT_OF_CLASS.conflict);
      expect(run.lines).toEqual([
        "import-bundle: REFUSED — this workspace's bundle could not be moved while the import was writing its manifest, because another writer moved it or holds its lock; nothing was written, so run the import again, and if it is refused the same way a lock was left on refs/heads/main",
      ]);
      expect(await commitsOf(served(), workspaceId)).toEqual([]);
    });

    it("exits 1 for an unsound tree, classed by no word", async () => {
      const { workspaceId, admin } = await bundleWorkspace(served());
      const from = await mkdtemp(path.join(tmpdir(), "bundle-"));

      const run = await importing(served(), workspaceId, admin.email, { from });

      expect(run.exitCode).toBe(1);
      expect(run.lines).toEqual([
        "import-bundle: REFUSED — manifest.yaml: the tree has no manifest.yaml at its root; nothing was written",
      ]);
      expect(await commitsOf(served(), workspaceId)).toEqual([]);
    });

    it("refuses a non-member's email, telling the operator to invite them", async () => {
      const { workspaceId } = await bundleWorkspace(served());

      const run = await importing(served(), workspaceId, "nobody@acme.invalid");

      expect(run.exitCode).toBe(EXIT_OF_CLASS.unauthenticated);
      expect(run.lines).toEqual([
        `import-bundle: REFUSED — nobody@acme.invalid is not a member of workspace ${workspaceId}; invite them first`,
      ]);
    });

    it("refuses a directory it cannot read, naming it", async () => {
      const { workspaceId, admin } = await bundleWorkspace(served());

      const run = await opsWith(
        served(),
        [
          "import-bundle",
          "--workspace",
          workspaceId,
          "--from",
          "/nowhere/bundle",
          "--as",
          admin.email,
        ],
        { io: { readTree: readTreeUnder } },
      );

      expect(run.exitCode).toBe(1);
      expect(run.lines.join("\n")).toContain(
        "import-bundle: REFUSED — the directory /nowhere/bundle could not be read:",
      );
    });

    it("answers usage to a --dry-run carrying a value, writing nothing", async () => {
      const { workspaceId, admin } = await bundleWorkspace(served());

      const run = await importing(served(), workspaceId, admin.email, {
        flags: ["--dry-run", "yes"],
      });

      expect(run.exitCode).toBe(2);
      expect(await commitsOf(served(), workspaceId)).toEqual([]);
      expect(await indexRowsOf(served(), workspaceId)).toEqual([]);
    });

    it("lands in a workspace provision-workspace and add-member stood up", async () => {
      const owner = await served().person(undefined, "Liam Owner");
      const provisioned = await provisioning(served(), [
        "--name",
        "Acme",
        "--short-name",
        aShortName(),
        "--admin",
        owner.email,
      ]);
      expect(provisioned.exitCode).toBe(0);
      const workspaceId = idOnTheDoneLine(provisioned);
      await verifierOf(served(), MONA, "Mona Reviewer");
      await verifierOf(served(), THEO, "Theo Approver");
      for (const verifier of [MONA, THEO]) {
        const added = await adding(served(), workspaceId, verifier, "Editor");
        expect(added.lines).toEqual([
          `add-member: done — ${verifier} added to workspace ${workspaceId} as Editor`,
        ]);
      }

      const run = await importing(served(), workspaceId, owner.email);

      expect(run.exitCode).toBe(0);
      expect(run.lines.at(-1)).toBe(
        "import-bundle: done — landed 6, skipped 0, 7 verifications recorded (0 already present), 4 links rewritten, 0.0 seconds",
      );
      const found = await reading(served(), workspaceId, owner.id, (principal, tx) =>
        find(principal, tx, { query: "retention", limit: 10 }, IMPORTED_AT),
      );
      const match = found.matches[0];
      assert(match?.layer === "bundles", "the match is not a concept");
      expect(trustWords(match.trust)).toBe("Verified by Theo Approver · 1 June 2026 · imported");
    });
  });
});
