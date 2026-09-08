import { serve } from "@hono/node-server";

import { describe, expect, it } from "vitest";

import { writeConcept } from "@better-answers/core/concepts";
import { head, initRepository } from "@better-answers/core/store/git";
import { openPostgres, withPrincipal } from "@better-answers/core/store/postgres";
import { testData } from "@better-answers/schema/testing";

import { fetchHonouringHost } from "../src/ops/http-fetch.ts";
import { NOT_BUILT, parseSince, runOps, type OpsIo } from "../src/ops/index.ts";
import { APP_HOSTNAME, openTestGit, PUBLIC_URL, type TestApp } from "./harness.ts";
import { servedApp } from "./suite-app.ts";

/**
 * The `pnpm ops` commands the estate's restore scripts call (ADR 0022, T-005), run against a
 * real, migrated Postgres and the app itself. What is held is the contract the scripts
 * rely on — `0` did it, `1` stop, `3` not built — on the schema as it stands today, and on
 * the schema as the slices will leave it (tables created here by the superuser, the way
 * the slices' migrations will).
 */

type Run = { readonly exitCode: number; readonly lines: readonly string[] };

const ioFor = (app: TestApp, stdin = ""): OpsIo & { readonly lines: string[] } => {
  const lines: string[] = [];
  return {
    lines,
    fetch: async (url, init) => app.server.request(url, init),
    stdin: async () => stdin,
    say: (line) => {
      lines.push(line);
    },
    appHostname: APP_HOSTNAME,
    gitStoreDir: app.gitStoreDir,
  };
};

const ops = async (app: TestApp, argv: readonly string[], stdin = ""): Promise<Run> => {
  const io = ioFor(app, stdin);
  const exitCode = await runOps(argv, app.database.superuser, io);
  return { exitCode, lines: io.lines };
};

/**
 * A map of two concepts and the link between them in the live generation, and a rebuild's
 * leftovers in a second generation beside it — what the two graph commands are asked about.
 */
const mapped = async (app: TestApp, workspaceId: string): Promise<void> => {
  const client = await app.database.superuser.connect();
  try {
    const seed = testData(client);
    const entry = await seed.graphNode({ workspaceId });
    await seed.graphEdge({ workspaceId, fromUid: entry.uid });
    const left = await seed.graphNode({ workspaceId, gen: 2 });
    await seed.graphEdge({ workspaceId, gen: 2, fromUid: left.uid });
  } finally {
    client.release();
  }
};

/** The one line a graph command answers with, as JSON. */
const answered = (run: Run): unknown => JSON.parse(run.lines[0] ?? "");

type QueuedJob = { id: string; kind: string; reason: string | null; status: string };

/** Every job on a workspace's queue, read as the superuser so no policy can hide one. */
const jobsOf = async (app: TestApp, workspaceId: string): Promise<readonly QueuedJob[]> => {
  const found = await app.database.superuser.query<QueuedJob>(
    "SELECT id, kind, reason, status FROM job WHERE workspace_id = $1",
    [workspaceId],
  );
  return found.rows;
};

/**
 * The worker's end of the job, as a test stands in for it: the row this command queued,
 * moved to a status it never leaves. The queue's own `claim_job` takes the oldest claimable
 * job rather than one named by id — it is the worker's protocol and the queue agreement is
 * where it is proved — so a test that wants *this* job finished moves this job's row, and
 * what is under test here is the command's reading of a status it did not write.
 */
const finishTheJob = async (app: TestApp, workspaceId: string, status: string): Promise<void> => {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    // The row's own CHECK ties an outcome to the two finishes and to nothing else, so the
    // stand-in writes one exactly where the worker would.
    const moved = await app.database.superuser.query(
      `UPDATE job SET status = $2, finished_at = now(),
              outcome = CASE WHEN $2 IN ('done', 'failed') THEN '{"generation": 2}'::jsonb END
        WHERE workspace_id = $1 AND status = 'queued'`,
      [workspaceId, status],
    );
    if ((moved.rowCount ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`nothing was ever queued in ${workspaceId}`);
};

describe("pnpm ops — the restore scripts' commands", () => {
  const app = servedApp();

  it("reads a dump stamp and an ISO instant as the same moment", () => {
    expect(parseSince("20260903T020500Z")?.toISOString()).toBe("2026-09-03T02:05:00.000Z");
    expect(parseSince("2026-09-03T02:05:00Z")?.toISOString()).toBe("2026-09-03T02:05:00.000Z");
    expect(parseSince("yesterday")).toBeUndefined();
  });

  it("answers usage, not a guess, to no command or an unknown one", async () => {
    expect((await ops(app(), [])).exitCode).toBe(2);
    expect((await ops(app(), ["make-it-so"])).exitCode).toBe(2);
    expect((await ops(app(), ["graph-counts"])).exitCode).toBe(2); // no --workspace
    expect((await ops(app(), ["replay-erasures"])).exitCode).toBe(2); // no --since
  });

  it("reads through the -- separator pnpm forwards, and does not read it as a command", async () => {
    // `pnpm ops replay-erasures …` arrives as `-- replay-erasures …` (first drill, 04/09/2026)
    expect(
      (await ops(app(), ["--", "replay-erasures", "--since", "20260904T000000Z"])).exitCode,
    ).toBe(0);
    expect((await ops(app(), ["--"])).exitCode).toBe(2); // a bare separator is still no command
  });

  describe("replay-erasures — mandatory in every restore, never quietly a no-op", () => {
    it("proves there is nothing to replay while no erasure has ever been recorded", async () => {
      const run = await ops(app(), ["replay-erasures", "--since", "20260901T020500Z"]);

      expect(run.exitCode).toBe(0);
      expect(run.lines.join("\n")).toContain("replayed 0 erasures");
      expect(run.lines.join("\n")).toContain("no erasure_request table");
    });

    it("refuses — stopping the restore before api starts — once erasures can exist and it cannot replay them", async () => {
      // Not a fixture: the erasure slice's table does not exist yet, and what is under test is
      // the command's reading of the catalogue — "a table by this name exists" — not any row.
      // The one column is the name; the moment the slice lands, its journal replaces this.
      await app().database.superuser.query(
        "CREATE TABLE erasure_request (id text primary key, completed_at timestamptz)",
      );
      try {
        const run = await ops(app(), ["replay-erasures", "--since", "2026-09-01T02:05:00Z"]);

        expect(run.exitCode).toBe(1);
        expect(run.lines.join("\n")).toContain("REFUSED");
      } finally {
        await app().database.superuser.query("DROP TABLE erasure_request");
      }
    });
  });

  describe("the slice-owned commands", () => {
    it.each(["erasure-rehearsal"])(
      "%s says `not built` — exit 3 — while its slice's tables are absent",
      async (command) => {
        const run = await ops(app(), [command, "--workspace", "ws_synthetic", "--wait", "--list"]);

        expect(run.exitCode).toBe(NOT_BUILT);
        expect(run.lines.join("\n")).toContain("not built");
      },
    );

    it.each(["object-store-orphans"])(
      "%s refuses — exit 1 — now its tables are there and the implementation is not",
      async (command) => {
        // T-053 landed the graph tables and T-055 `source_document`, so *not built* has
        // stopped being true for this command; T-058 filled in the three graph commands
        // below and the orphan sweep waits on the sources slice. That is exactly the state
        // the third answer is for: the tables exist and this image has no implementation,
        // which is a refusal a restore must stop on rather than a silence.
        const run = await ops(app(), [command, "--workspace", "ws_synthetic", "--wait"]);

        expect(run.exitCode).toBe(1);
        expect(run.lines.join("\n")).toContain("REFUSED");
      },
    );
  });

  describe("graph-rebuild — the map made again, on the worker's queue", () => {
    it("queues a full rebuild for the drill and answers the id of the job it queued", async () => {
      const { workspaceId } = await app().provision();

      const run = await ops(app(), ["graph-rebuild", "--workspace", workspaceId]);

      expect(run.exitCode).toBe(0);
      const queued = await jobsOf(app(), workspaceId);
      // The reason defaults to the drill's, because the restore drill is the caller.
      expect(queued).toEqual([
        { id: expect.any(String), kind: "full-rebuild", reason: "drill", status: "queued" },
      ]);
      expect(run.lines).toEqual([`graph-rebuild: done — enqueued ${queued[0]?.id}`]);
    });

    it("takes one of ADR 0023's six reasons when the caller names one", async () => {
      const { workspaceId } = await app().provision();

      const run = await ops(app(), [
        "graph-rebuild",
        "--workspace",
        workspaceId,
        "--reason",
        "upgrade",
      ]);

      expect(run.exitCode).toBe(0);
      expect((await jobsOf(app(), workspaceId))[0]?.reason).toBe("upgrade");
    });

    it("answers usage to a reason that is not one of the six, and queues nothing", async () => {
      const { workspaceId } = await app().provision();

      const run = await ops(app(), [
        "graph-rebuild",
        "--workspace",
        workspaceId,
        "--reason",
        "because-i-said-so",
      ]);

      expect(run.exitCode).toBe(2);
      expect(await jobsOf(app(), workspaceId)).toEqual([]);
    });

    it("answers usage to a workspace that is not an id, before it queues anything", async () => {
      const run = await ops(app(), ["graph-rebuild", "--workspace", "ws_synthetic"]);

      expect(run.exitCode).toBe(2);
    });

    it.each([
      ["a --wait carrying a value", ["--wait", "soon"]],
      ["a --wait-seconds that is not a whole number of seconds", ["--wait-seconds", "soon"]],
      ["a --wait-seconds of no seconds at all", ["--wait-seconds", "0"]],
    ])("answers usage to %s, and queues nothing", async (_shape, flags) => {
      const { workspaceId } = await app().provision();

      const run = await ops(app(), ["graph-rebuild", "--workspace", workspaceId, ...flags]);

      expect(run.exitCode).toBe(2);
      expect(await jobsOf(app(), workspaceId)).toEqual([]);
    });

    it("waits the rebuild's own budget by default — ADR 0032's two minutes — and says so in its usage", async () => {
      // The budget is the promise, not a multiple of a measurement: a rebuild that has not
      // finished in two minutes is the thing an operator has to look at, and a longer wait
      // is asked for explicitly with --wait-seconds rather than granted by the default.
      const run = await ops(app(), ["help"]);

      expect(run.exitCode).toBe(0);
      expect(run.lines.join("\n")).toContain(
        "--wait    poll the job until it is over, 120 seconds",
      );
      expect(run.lines.join("\n")).toContain("--wait-seconds <n>");
    });

    it("waits for the job it queued and is done once the worker has finished it", async () => {
      const { workspaceId } = await app().provision();

      const waiting = ops(app(), ["graph-rebuild", "--workspace", workspaceId, "--wait"]);
      await finishTheJob(app(), workspaceId, "done");
      const run = await waiting;

      expect(run.exitCode).toBe(0);
      expect(run.lines.join("\n")).toContain("rebuilt the map");
    });

    it.each(["failed", "poisoned"])(
      "refuses — so the restore stops — when the job it waited for is %s",
      async (status) => {
        const { workspaceId } = await app().provision();

        const waiting = ops(app(), ["graph-rebuild", "--workspace", workspaceId, "--wait"]);
        await finishTheJob(app(), workspaceId, status);
        const run = await waiting;

        expect(run.exitCode).toBe(1);
        expect(run.lines.join("\n")).toContain("REFUSED");
        expect(run.lines.join("\n")).toContain(status);
      },
    );

    it("refuses when the job is still queued at the end of the wait it was given", async () => {
      const { workspaceId } = await app().provision();

      // A one-second wait, because nothing claims the job in this process: the drill's own
      // wait is the two-minute budget and this flag is what an estate with a slower worker
      // says explicitly.
      const run = await ops(app(), [
        "graph-rebuild",
        "--workspace",
        workspaceId,
        "--wait-seconds",
        "1",
      ]);

      expect(run.exitCode).toBe(1);
      expect(run.lines.join("\n")).toContain("still queued");
      expect((await jobsOf(app(), workspaceId))[0]?.status).toBe("queued");
    });
  });

  describe("graph-counts — nodes per label and edges, as JSON, for the drill's diff", () => {
    it("answers the live generation and the source entities beside it, on one line a diff can read", async () => {
      const { workspaceId } = await app().provision();
      await mapped(app(), workspaceId);

      const run = await ops(app(), ["graph-counts", "--workspace", workspaceId]);

      expect(run.exitCode).toBe(0);
      // One line, because the drill redirects it to a file and diffs it against the counts
      // production's last good sync run stamped (`restore-drill.sh` step 6).
      expect(run.lines).toHaveLength(1);
      expect(answered(run)).toEqual({
        live_gen: 1,
        nodes: { Concept: 2 },
        edges: { LINKS_TO: 1 },
      });
    });

    it("is done over a workspace nobody has mapped, answering zero of everything rather than refusing", async () => {
      const { workspaceId } = await app().provision();

      const run = await ops(app(), ["graph-counts", "--workspace", workspaceId]);

      expect(run.exitCode).toBe(0);
      expect(answered(run)).toEqual({ live_gen: null, nodes: {}, edges: {} });
    });

    it("answers usage to a workspace that is not an id, before it reads anything", async () => {
      const run = await ops(app(), ["graph-counts", "--workspace", "ws_synthetic"]);

      expect(run.exitCode).toBe(2);
    });
  });

  describe("graph-sweep — the generations a finished rebuild left behind", () => {
    it("removes every generation but the live one and says which, with what each held", async () => {
      const { workspaceId } = await app().provision();
      await mapped(app(), workspaceId);

      const run = await ops(app(), ["graph-sweep", "--workspace", workspaceId, "--wait"]);

      expect(run.exitCode).toBe(0);
      expect(run.lines).toEqual(["graph-sweep: done — swept generation 2 (2 nodes, 1 edge)"]);
      // The live generation is untouched, which is what the counts read back says.
      const counted = await ops(app(), ["graph-counts", "--workspace", workspaceId]);
      expect(answered(counted)).toEqual({
        live_gen: 1,
        nodes: { Concept: 2 },
        edges: { LINKS_TO: 1 },
      });
    });

    it("is done with nothing to sweep over a workspace whose map is only its live generation", async () => {
      const { workspaceId } = await app().provision();

      const run = await ops(app(), ["graph-sweep", "--workspace", workspaceId]);

      expect(run.exitCode).toBe(0);
      expect(run.lines).toEqual(["graph-sweep: done — nothing to sweep"]);
    });

    it("answers usage to a workspace that is not an id, before it deletes anything", async () => {
      const run = await ops(app(), ["graph-sweep", "--workspace", "ws_synthetic"]);

      expect(run.exitCode).toBe(2);
    });
  });

  describe("reconcile-watermark — the reconciler on demand, which is the restore path", () => {
    it("refuses without a repositories' root, because a bundle it cannot open is nothing to reconcile against", async () => {
      const { workspaceId } = await app().provision();
      const io: OpsIo & { readonly lines: string[] } = { ...ioFor(app()), gitStoreDir: undefined };

      const exitCode = await runOps(
        ["reconcile-watermark", "--workspace", workspaceId],
        app().database.superuser,
        io,
      );

      expect(exitCode).toBe(1);
      expect(io.lines.join("\n")).toContain("REFUSED");
      expect(io.lines.join("\n")).toContain("GIT_STORE_DIR");
    });

    it("refuses a repositories' root that names a missing directory, the same as an absent one", async () => {
      const { workspaceId } = await app().provision();
      const io: OpsIo & { readonly lines: string[] } = {
        ...ioFor(app()),
        gitStoreDir: `${app().gitStoreDir}/does-not-exist`,
      };

      const exitCode = await runOps(
        ["reconcile-watermark", "--workspace", workspaceId],
        app().database.superuser,
        io,
      );

      expect(exitCode).toBe(1);
      expect(io.lines).toEqual([
        `reconcile-watermark: REFUSED — the repositories' root is no-such-root (GIT_STORE_DIR=${app().gitStoreDir}/does-not-exist)`,
      ]);
    });

    it("answers usage to a workspace that is not an id, before it opens anything", async () => {
      const run = await ops(app(), ["reconcile-watermark", "--workspace", "ws_synthetic"]);

      expect(run.exitCode).toBe(2);
    });

    it("refuses a workspace whose repository is not there, which on a restore is a store that was not restored", async () => {
      const { workspaceId } = await app().provision();

      const run = await ops(app(), ["reconcile-watermark", "--workspace", workspaceId]);

      expect(run.exitCode).toBe(1);
      expect(run.lines).toEqual(["reconcile-watermark: REFUSED — no-such-repository"]);
    });

    it("is done — exit 0 — once the rows and the bundle agree, and says what the run found", async () => {
      const { workspaceId } = await app().provision();
      await initRepository(openTestGit(app()), workspaceId);

      const run = await ops(app(), ["reconcile-watermark", "--workspace", workspaceId]);

      expect(run.exitCode).toBe(0);
      expect(run.lines).toEqual([
        "reconcile-watermark: done — head none, watermark none, replayed 0, already landed 0",
      ]);
    });

    it("is done — exit 0 — after replaying the commit a bundle's rows missed, and the concept's row has landed", async () => {
      const { workspaceId, admin } = await app().provision();
      const git = openTestGit(app());
      await initRepository(git, workspaceId);
      const principal = await withPrincipal(
        openPostgres(app().database.pool),
        { workspaceId, userId: admin.id, issuedAt: new Date() },
        async (resolved) => resolved,
      );
      if (!principal.ok) throw new Error(`the principal did not resolve: ${principal.error}`);
      // The crash window, as `packages/core/test/reconciler.test.ts` opens it: while the
      // trigger stands, the act's commit lands and its rows do not — the restore path's shape.
      const superuser = app().database.superuser;
      await superuser.query(
        `CREATE FUNCTION crash_in_the_window() RETURNS trigger LANGUAGE plpgsql AS $$
           BEGIN RAISE EXCEPTION 'the process died between the commit and its rows'; END $$`,
      );
      await superuser.query(
        "CREATE TRIGGER crash_in_the_window BEFORE INSERT ON bundle_commit FOR EACH ROW EXECUTE FUNCTION crash_in_the_window()",
      );
      try {
        const lost = await writeConcept(
          principal.value,
          { git, postgres: openPostgres(app().database.pool) },
          {
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
          },
        );
        expect(lost.ok).toBe(false);
      } finally {
        await superuser.query("DROP TRIGGER crash_in_the_window ON bundle_commit");
        await superuser.query("DROP FUNCTION crash_in_the_window()");
      }
      const sha = await head(principal.value, git);

      const run = await ops(app(), ["reconcile-watermark", "--workspace", workspaceId]);

      expect(run.exitCode).toBe(0);
      expect(run.lines).toEqual([
        `reconcile-watermark: done — head ${sha}, watermark none, replayed 1, already landed 0`,
      ]);
      const landed = await superuser.query<{ path: string; commit_sha: string }>(
        "SELECT path, commit_sha FROM concept_index WHERE workspace_id = $1",
        [workspaceId],
      );
      expect(landed.rows).toEqual([{ path: "knowledge/restore-drill.md", commit_sha: sha }]);
    });
  });

  describe("smoke — the platform answers through its interface", () => {
    it("passes against the running app: health, the protected-resource document, the bearer challenge, the shell", async () => {
      const run = await ops(app(), ["smoke", "--url", PUBLIC_URL, "--find", "--guide", "--ask"]);

      expect(run.lines.filter((line) => line.startsWith("FAIL"))).toEqual([]);
      expect(run.exitCode).toBe(0);
      expect(run.lines.filter((line) => line.startsWith("ok  "))).toHaveLength(4);
      // The three entries are named and honestly deferred, never reported as passed.
      expect(run.lines.filter((line) => line.startsWith("note "))).toHaveLength(3);
    });

    it("passes on the loopback the way the drill reaches it, by sending the app hostname as Host through node:http", async () => {
      // The drill and the production restore call `smoke --url http://127.0.0.1:3000` from
      // inside the stack. The fence carries /health alone on the loopback, and Node's fetch
      // drops a `host` header, so this is the one path a harness `server.request` cannot prove.
      let listener: ReturnType<typeof serve> | undefined;
      const port = await new Promise<number>((resolve) => {
        listener = serve({ fetch: app().server.fetch, port: 0, hostname: "127.0.0.1" }, (info) =>
          resolve(info.port),
        );
      });
      const url = `http://127.0.0.1:${port}`;
      try {
        const io = ioFor(app());
        const withHost: OpsIo = { ...io, fetch: fetchHonouringHost };
        expect(await runOps(["smoke", "--url", url], app().database.pool, withHost)).toBe(0);
        expect(io.lines.filter((line) => line.startsWith("FAIL"))).toEqual([]);

        // And without the hostname the fence refuses everything but /health — the failure
        // the header exists to prevent, shown rather than assumed.
        const bare: OpsIo = { ...ioFor(app()), fetch: fetchHonouringHost, appHostname: undefined };
        expect(await runOps(["smoke", "--url", url], app().database.pool, bare)).toBe(1);
      } finally {
        await new Promise<void>((resolve) => listener?.close(() => resolve()));
      }
    });

    it("fails when the surface does not answer", async () => {
      const run = await ops(app(), ["smoke", "--url", "https://nowhere.example.test"]);

      expect(run.exitCode).toBe(1);
    });
  });

  describe("dump-grep — present or absent per token, never the line", () => {
    it("reports each token's presence over a plain-SQL dump on stdin and quotes nothing", async () => {
      const dump =
        "COPY person (id, email) FROM stdin;\n1\tjane@example.test\n2\tother@example.test\n\\.\n";
      const run = await ops(
        app(),
        ["dump-grep", "--tokens", "jane@example.test,nobody@example.test"],
        dump,
      );

      expect(run.exitCode).toBe(0);
      expect(run.lines).toEqual(["jane…st: present in 1 line(s)", "nobo…st: absent"]);
      expect(run.lines.join("\n")).not.toContain("other@example.test");
    });
  });
});
