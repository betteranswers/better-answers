import { fileURLToPath } from "node:url";

import { assert, describe, expect, it } from "vitest";

import { open, trustWords } from "@better-answers/core/answering";
import { contentHashOf, parseConceptFile } from "@better-answers/core/concepts";
import { actorIdOf, err, type UserPrincipal } from "@better-answers/core/kernel";
import { commit, fileAtHead, head, initRepository } from "@better-answers/core/store/git";
import type { Foldable, Tx } from "@better-answers/core/store/postgres";
import { CONCEPT_BODY_MAX, conceptIriOf, ids, ulid } from "@better-answers/schema";
import { matching } from "@better-answers/schema/testing/matching";

import { runOps } from "../../src/ops/index.ts";
import { readTreeUnder } from "../../src/ops/read-tree.ts";
import {
  actingIn,
  capturingLogger,
  openTestGit,
  type TestApp,
} from "../support/harness/harness.ts";
import { appForSuite } from "../support/suite-app.ts";

const app = appForSuite();

const BUNDLE_FIXTURE = fileURLToPath(new URL("../fixtures/bundle", import.meta.url));
const IMPORTED_AT = new Date("2026-09-22T10:00:00.000Z");
const MONA = "mona.reviewer@acme.invalid";
const THEO = "theo.approver@acme.invalid";

const RETENTION = "knowledge/company/answers/data-retention-period.md";
const SUPPORT = "knowledge/company/answers/support-hours.md";
const NOTE = "When asked: What happens to our data at the end of the contract?";
const RETENTION_LINE =
  "Retention is ninety days beyond termination. Within that window the customer may export everything as a single archive; after it, deletion is certified in writing within five working days.";
const RETENTION_IS = "Retention is ninety days";
const RETENTION_RUNS = "Retention runs for ninety days";
const CHANGED_LINES = [
  `- ${NOTE}`,
  "- ",
  `- ${RETENTION_LINE}`,
  `+ ${RETENTION_LINE.replace(RETENTION_IS, RETENTION_RUNS)}`,
];

type Run = { readonly exitCode: number; readonly lines: readonly string[] };

const ops = async (argv: readonly string[], stdin = ""): Promise<Run> => {
  const lines: string[] = [];
  const exitCode = await runOps(
    argv,
    { ...app().doors, clock: { now: () => IMPORTED_AT } },
    {
      fetch: async (url, init) => app().server.request(url, init),
      stdin: async () => stdin,
      say: (line) => {
        lines.push(line);
      },
      logger: capturingLogger().logger,
      readTree: readTreeUnder,
      modelKeySetting: err("this suite's commands are given no envelope key"),
    },
  );
  return { exitCode, lines };
};

const reading = <T>(
  workspaceId: string,
  userId: string,
  work: (principal: UserPrincipal, tx: Tx) => Promise<Foldable<T>>,
) => actingIn(app(), { workspaceId, userId }, work);

const verifierIds = new Map<string, string>();

const verifierOf = async (application: TestApp, email: string, name: string): Promise<string> => {
  const known = verifierIds.get(email);
  if (known !== undefined) return known;
  const { id } = await application.person(email, name);
  verifierIds.set(email, id);
  return id;
};

type Update = {
  readonly workspaceId: string;
  readonly iri: string;
  readonly as: string;
  readonly expect: string | undefined;
  readonly body: string;
  readonly dryRun: boolean;
};

const updating = (asked: Update): Promise<Run> =>
  ops(
    [
      "update-concept-body",
      "--workspace",
      asked.workspaceId,
      "--iri",
      asked.iri,
      "--as",
      asked.as,
      ...(asked.expect === undefined ? [] : ["--expect", asked.expect]),
      ...(asked.dryRun ? ["--dry-run"] : []),
    ],
    asked.body,
  );

const conceptAt = async (workspaceId: string, path: string) => {
  const found = await app().database.superuser.query<{
    iri: string;
    content_hash: string;
    commit_sha: string;
    status: string;
    body: string;
  }>(
    `SELECT iri, content_hash, commit_sha, status, body FROM concept_index
      WHERE workspace_id = $1 AND path = $2`,
    [workspaceId, path],
  );
  const row = found.rows[0];
  if (row === undefined) throw new Error(`no concept stands at ${path}`);
  return row;
};

const imported = async () => {
  const { workspaceId, admin } = await app().provision();
  await initRepository(openTestGit(app()), workspaceId);
  for (const [email, name] of [
    [MONA, "Mona Reviewer"],
    [THEO, "Theo Approver"],
  ] as const) {
    await app().addMember(workspaceId, await verifierOf(app(), email, name), "Editor");
  }
  const landed = await ops([
    "import-bundle",
    "--workspace",
    workspaceId,
    "--from",
    BUNDLE_FIXTURE,
    "--as",
    admin.email,
  ]);
  if (landed.exitCode !== 0) throw new Error(`the import failed: ${landed.lines.join("\n")}`);

  const principal = await reading(workspaceId, admin.id, async (resolved) => resolved);
  const held = await conceptAt(workspaceId, RETENTION);
  const fileNow = async (): Promise<string> =>
    (await fileAtHead(principal, openTestGit(app()), RETENTION)) ?? "";
  const file = parseConceptFile(await fileNow());
  if (!file.ok) throw new Error("the imported file does not parse");
  const nextBody = file.value.body.replace(`${NOTE}\n\n`, "").replace(RETENTION_IS, RETENTION_RUNS);

  const valid: Update = {
    workspaceId,
    iri: held.iri,
    as: admin.email,
    expect: held.content_hash,
    body: nextBody,
    dryRun: false,
  };
  return {
    workspaceId,
    admin,
    principal,
    held,
    file: file.value,
    nextBody,
    fileNow,
    update: (overrides: Partial<Update> = {}) => updating({ ...valid, ...overrides }),
  };
};

const verificationsOf = async (workspaceId: string, iri: string) => {
  const found = await app().database.superuser.query<Record<string, unknown>>(
    `SELECT actor, verified_at, content_hash, origin FROM concept_verification
      WHERE workspace_id = $1 AND iri = $2 ORDER BY verified_at`,
    [workspaceId, iri],
  );
  return found.rows;
};

const committedEventsOf = async (workspaceId: string, iri: string) => {
  const found = await app().database.superuser.query<{
    id: string;
    actor: string;
    detail: Record<string, unknown>;
  }>(
    `SELECT id, actor, detail FROM audit_event
      WHERE workspace_id = $1 AND action = 'knowledge.concept.committed' AND subject_id = $2`,
    [workspaceId, iri],
  );
  return found.rows;
};

const countOf = async (table: "bundle_commit" | "audit_event", workspaceId: string) => {
  const found = await app().database.superuser.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM ${table} WHERE workspace_id = $1`,
    [workspaceId],
  );
  return found.rows[0]?.count;
};

const standingOf = async (scene: Awaited<ReturnType<typeof imported>>) => ({
  row: await conceptAt(scene.workspaceId, RETENTION),
  file: await scene.fileNow(),
  commits: await countOf("bundle_commit", scene.workspaceId),
  events: await countOf("audit_event", scene.workspaceId),
});

const frontmatterOf = (file: string): string => file.slice(0, file.indexOf("\n---\n") + 5);

const changedLinesOf = (run: Run): readonly string[] =>
  run.lines.slice(1, -1).filter((line) => !line.startsWith("  "));

const movedSaid = (iri: string, base: string): string =>
  `update-concept-body: REFUSED — ${iri} moved: it no longer stands at ${base}, or its file at the bundle's head is ahead of its row; nothing was written. Run with --dry-run again, and if that refuses the same way a minute later, the rows are behind the bundle: RUNBOOK page 10`;

const MODES = [
  ["write", false],
  ["dry run", true],
] as const;

describe("pnpm ops update-concept-body: a standing concept's body replaced in place", () => {
  it("updates the body, keeping frontmatter bytes, status and verifications", async () => {
    const scene = await imported();
    const before = await scene.fileNow();
    const verified = await verificationsOf(scene.workspaceId, scene.held.iri);

    const run = await scene.update();

    expect(run.exitCode).toBe(0);
    const after = await scene.fileNow();
    expect(frontmatterOf(after)).toBe(frontmatterOf(before));
    expect(after.slice(frontmatterOf(after).length)).toBe(`\n${scene.nextBody}`);
    expect(after).not.toContain(NOTE);
    const row = await conceptAt(scene.workspaceId, RETENTION);
    expect({ status: row.status, body: row.body }).toEqual({
      status: scene.held.status,
      body: scene.nextBody,
    });
    expect(await verificationsOf(scene.workspaceId, scene.held.iri)).toEqual(verified);
    expect(verified).toHaveLength(2);
  });

  it("says both hashes and the short commit when done", async () => {
    const scene = await imported();
    const to = contentHashOf(scene.file.frontmatter, scene.nextBody, RETENTION);

    const run = await scene.update();

    const row = await conceptAt(scene.workspaceId, RETENTION);
    expect(run.lines).toEqual([
      `update-concept-body: done — ${RETENTION} moved from ${scene.held.content_hash} to ${to}, commit ${row.commit_sha.slice(0, 7)}; frontmatter, status, verification and citations kept`,
    ]);
    expect(row.content_hash).toBe(to);
  });

  it("keeps the imported verification's trust current after the update", async () => {
    const scene = await imported();

    await scene.update();

    const opened = await reading(scene.workspaceId, scene.admin.id, (principal, tx) =>
      open(principal, tx, { iri: ids.conceptIri.parse(scene.held.iri) }, IMPORTED_AT),
    );
    assert(opened.found, "the updated concept did not open");
    const trust = opened.concept?.trust;
    assert(trust !== undefined, "the updated concept carries its trust");
    expect({ words: trustWords(trust), status: trust.status }).toEqual({
      words: "Verified by Theo Approver · 1 June 2026 · imported",
      status: "current",
    });
  });

  it("writes one committed event naming both hashes, no body", async () => {
    const scene = await imported();
    const earlier = await committedEventsOf(scene.workspaceId, scene.held.iri);

    await scene.update();

    const later = await committedEventsOf(scene.workspaceId, scene.held.iri);
    const known = new Set(earlier.map((event) => event.id));
    const added = later.filter((event) => !known.has(event.id));
    const row = await conceptAt(scene.workspaceId, RETENTION);
    expect(added).toEqual([
      {
        id: matching.any(String),
        actor: `human:${scene.admin.id}`,
        detail: {
          iri: scene.held.iri,
          commitSha: row.commit_sha,
          contentHash: row.content_hash,
          fromContentHash: scene.held.content_hash,
          evidenceCount: 0,
        },
      },
    ]);
    expect(JSON.stringify(added)).not.toContain("ninety days");
  });

  it("dry run prints the held hash and diff, writes nothing", async () => {
    const scene = await imported();
    const before = await standingOf(scene);
    const to = contentHashOf(scene.file.frontmatter, scene.nextBody, RETENTION);

    const run = await scene.update({ dryRun: true, expect: undefined });

    expect(run.exitCode).toBe(0);
    expect(run.lines[0]).toBe(
      `update-concept-body: ${RETENTION} stands at ${scene.held.content_hash}; pass it as --expect`,
    );
    expect(changedLinesOf(run)).toEqual(CHANGED_LINES);
    expect(run.lines.at(-1)).toBe(
      `update-concept-body: dry run — the body would move ${RETENTION} from ${scene.held.content_hash} to ${to}; frontmatter, status, verification and citations kept; nothing was written`,
    );
    expect(await standingOf(scene)).toEqual(before);
  });

  it("diffs and lands a CRLF body by its normalised lines", async () => {
    const scene = await imported();
    const crlf = scene.nextBody.replaceAll("\n", "\r\n");

    const dry = await scene.update({ dryRun: true, expect: undefined, body: crlf });
    const run = await scene.update({ body: crlf });

    expect(changedLinesOf(dry)).toEqual(CHANGED_LINES);
    expect(run.exitCode).toBe(0);
    expect((await conceptAt(scene.workspaceId, RETENTION)).body).toBe(scene.nextBody);
  });

  it.each(MODES)("refuses a moved hash on a %s as stale-precondition", async (_mode, dryRun) => {
    const scene = await imported();
    const other = await conceptAt(scene.workspaceId, SUPPORT);
    const before = await standingOf(scene);

    const run = await scene.update({ dryRun, expect: other.content_hash });

    expect(run.exitCode).toBe(8);
    expect(run.lines).toEqual([movedSaid(scene.held.iri, other.content_hash)]);
    expect(await standingOf(scene)).toEqual(before);
  });

  it("refuses a head ahead of its row as stale-precondition", async () => {
    const scene = await imported();
    const git = openTestGit(app());
    const inFlight = await commit(scene.principal, git, {
      path: RETENTION,
      content: (await scene.fileNow()).replace(RETENTION_IS, RETENTION_RUNS),
      message: "Write the retention answer, its rows not yet landed",
      author: { name: "Grace Editor", email: "grace@acme.invalid" },
      trailers: { actor: actorIdOf(scene.principal), audit: ulid() },
      expectedHead: await head(scene.principal, git),
      at: IMPORTED_AT,
    });
    expect(inFlight).toMatchObject({ ok: true });
    const before = await standingOf(scene);

    const run = await scene.update();

    expect(run.exitCode).toBe(8);
    expect(run.lines).toEqual([movedSaid(scene.held.iri, scene.held.content_hash)]);
    expect(await standingOf(scene)).toEqual(before);
  });

  it("refuses an unknown iri as no-such-concept, writing nothing", async () => {
    const scene = await imported();
    const unknown = conceptIriOf(ulid());
    const before = await standingOf(scene);

    const run = await scene.update({ iri: unknown });

    expect(run.exitCode).toBe(6);
    expect(run.lines).toEqual([
      `update-concept-body: REFUSED — no concept ${unknown} stands in workspace ${scene.workspaceId} that ${scene.admin.email} can read; a Restricted concept needs an Admin; nothing was written`,
    ]);
    expect(await standingOf(scene)).toEqual(before);
  });

  it.each([
    ["the held body", ""],
    ["the held body plus trailing whitespace", "   \n\n\n"],
  ])("refuses %s as unchanged", async (_shape, trailing) => {
    const scene = await imported();
    const before = await standingOf(scene);

    const run = await scene.update({ body: `${scene.file.body}${trailing}` });

    expect(run.exitCode).toBe(7);
    expect(run.lines).toEqual([
      `update-concept-body: REFUSED — the body given is the one ${scene.held.iri} already holds; nothing was written`,
    ]);
    expect(await standingOf(scene)).toEqual(before);
  });

  it("refuses a body over the limit once normalised, even dry", async () => {
    const scene = await imported();
    const before = await standingOf(scene);

    const run = await scene.update({
      dryRun: true,
      expect: undefined,
      body: "x".repeat(CONCEPT_BODY_MAX),
    });

    expect(run.exitCode).toBe(2);
    expect(run.lines).toEqual([
      `update-concept-body: REFUSED — --iri ${scene.held.iri} is not a concept iri, or the body is longer than a concept holds; nothing was written`,
    ]);
    expect(await standingOf(scene)).toEqual(before);
  });

  it("refuses a --as who is no member, exit 4", async () => {
    const scene = await imported();
    const stranger = await app().person();
    const before = await standingOf(scene);

    const run = await scene.update({ as: stranger.email });

    expect(run.exitCode).toBe(4);
    expect(run.lines).toEqual([
      `update-concept-body: REFUSED — ${stranger.email} is not a member of workspace ${scene.workspaceId}; invite them first`,
    ]);
    expect(await standingOf(scene)).toEqual(before);
  });

  it.each(MODES)("refuses a Viewer's %s as owner-forbids, exit 5", async (_mode, dryRun) => {
    const scene = await imported();
    const viewer = await app().person();
    await app().addMember(scene.workspaceId, viewer.id, "Viewer");
    const before = await standingOf(scene);

    const run = await scene.update({ dryRun, as: viewer.email });

    expect(run.exitCode).toBe(5);
    expect(run.lines).toEqual([
      `update-concept-body: REFUSED — ${viewer.email} neither owns ${scene.held.iri} nor is an Admin of this workspace; nothing was written`,
    ]);
    expect(await standingOf(scene)).toEqual(before);
  });

  it("answers usage to an empty stdin, writing nothing", async () => {
    const scene = await imported();
    const before = await standingOf(scene);

    const run = await scene.update({ body: "" });

    expect(run).toEqual({
      exitCode: 2,
      lines: ["update-concept-body: the new body is read from stdin, and stdin was empty"],
    });
    expect(await standingOf(scene)).toEqual(before);
  });
});
