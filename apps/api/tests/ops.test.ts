import { serve } from "@hono/node-server";

import { describe, expect, it } from "vitest";

import { initRepository, openGit } from "@better-answers/core/store/git";
import { testData } from "@better-answers/schema/testing";

import { fetchHonouringHost } from "../src/ops/http-fetch.ts";
import { NOT_BUILT, parseSince, runOps, type OpsIo } from "../src/ops/index.ts";
import { APP_HOSTNAME, PUBLIC_URL, type TestApp } from "./harness.ts";
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

    it.each(["graph-rebuild", "object-store-orphans"])(
      "%s refuses — exit 1 — now its tables are there and the implementation is not",
      async (command) => {
        // T-053 landed the graph tables and T-055 `source_document`, so *not built* has
        // stopped being true for these commands; T-058 filled in the two graph commands
        // below, the rebuild waits on the worker's queue and the orphan sweep on the
        // sources slice. That is exactly the state the third answer is for: the tables
        // exist and this image has no implementation, which is a refusal a restore must
        // stop on rather than a silence.
        const run = await ops(app(), [command, "--workspace", "ws_synthetic", "--wait"]);

        expect(run.exitCode).toBe(1);
        expect(run.lines.join("\n")).toContain("REFUSED");
      },
    );
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
      await initRepository(openGit(app().gitStoreDir), workspaceId);

      const run = await ops(app(), ["reconcile-watermark", "--workspace", workspaceId]);

      expect(run.exitCode).toBe(0);
      expect(run.lines).toEqual([
        "reconcile-watermark: done — head none, watermark none, replayed 0, already landed 0",
      ]);
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
