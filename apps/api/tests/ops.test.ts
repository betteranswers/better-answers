import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { NOT_BUILT, parseSince, runOps, type OpsIo } from "../src/ops/index.ts";
import { APP_HOSTNAME, PUBLIC_URL, startApp, type TestApp } from "./harness.ts";

/**
 * The `pnpm ops` commands the deploy unit's scripts call (ADR 0022, T-005), run against a
 * real, migrated Postgres and the app itself. What is held is the contract the scripts
 * rely on — `0` did it, `1` stop, `3` not built — on the schema as it stands today, and on
 * the schema as the slices will leave it (tables created here by the superuser, the way
 * the slices' migrations will).
 */

/** The fixture build `spa.test.ts` serves: enough of a shell for the smoke test to find it. */
const WEB_ROOT = fileURLToPath(new URL("fixtures/web-build", import.meta.url));

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
  };
};

const ops = async (app: TestApp, argv: readonly string[], stdin = ""): Promise<Run> => {
  const io = ioFor(app, stdin);
  const exitCode = await runOps(argv, app.database.superuser, io);
  return { exitCode, lines: io.lines };
};

describe("pnpm ops — the deploy unit's commands", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await startApp({ webRoot: WEB_ROOT });
  });

  afterAll(async () => {
    await app.stop();
  });

  it("reads a dump stamp and an ISO instant as the same moment", () => {
    expect(parseSince("20260903T020500Z")?.toISOString()).toBe("2026-09-03T02:05:00.000Z");
    expect(parseSince("2026-09-03T02:05:00Z")?.toISOString()).toBe("2026-09-03T02:05:00.000Z");
    expect(parseSince("yesterday")).toBeUndefined();
  });

  it("answers usage, not a guess, to no command or an unknown one", async () => {
    expect((await ops(app, [])).exitCode).toBe(2);
    expect((await ops(app, ["make-it-so"])).exitCode).toBe(2);
    expect((await ops(app, ["graph-counts"])).exitCode).toBe(2); // no --workspace
    expect((await ops(app, ["replay-erasures"])).exitCode).toBe(2); // no --since
  });

  describe("replay-erasures — mandatory in every restore, never quietly a no-op", () => {
    it("proves there is nothing to replay while no erasure has ever been recorded", async () => {
      const run = await ops(app, ["replay-erasures", "--since", "20260901T020500Z"]);

      expect(run.exitCode).toBe(0);
      expect(run.lines.join("\n")).toContain("replayed 0 erasures");
      expect(run.lines.join("\n")).toContain("no erasure_request table");
    });

    it("refuses — stopping the restore before api starts — once erasures can exist and it cannot replay them", async () => {
      await app.database.superuser.query(
        "CREATE TABLE erasure_request (id text primary key, completed_at timestamptz)",
      );
      try {
        const run = await ops(app, ["replay-erasures", "--since", "2026-09-01T02:05:00Z"]);

        expect(run.exitCode).toBe(1);
        expect(run.lines.join("\n")).toContain("REFUSED");
      } finally {
        await app.database.superuser.query("DROP TABLE erasure_request");
      }
    });
  });

  describe("the slice-owned commands", () => {
    it.each([
      "graph-rebuild",
      "graph-sweep",
      "graph-counts",
      "reconcile-watermark",
      "object-store-orphans",
      "erasure-rehearsal",
    ])("%s says `not built` — exit 3 — while its slice's tables are absent", async (command) => {
      const run = await ops(app, [command, "--workspace", "ws_synthetic", "--wait", "--list"]);

      expect(run.exitCode).toBe(NOT_BUILT);
      expect(run.lines.join("\n")).toContain("not built");
    });

    it("graph-counts counts nodes per label and edges inside the workspace's scope once the graph tables exist", async () => {
      // The shape ADR 0032 names: tenant tables under RLS with `workspace_id` and a closed
      // `label` column. Created here as the graph slice's migration will, under the same seam.
      const superuser = app.database.superuser;
      await superuser.query(`
        CREATE TABLE graph_node (id text primary key, workspace_id text not null, label text not null);
        CREATE TABLE graph_edge (id text primary key, workspace_id text not null);
        ALTER TABLE graph_node ENABLE ROW LEVEL SECURITY; ALTER TABLE graph_node FORCE ROW LEVEL SECURITY;
        ALTER TABLE graph_edge ENABLE ROW LEVEL SECURITY; ALTER TABLE graph_edge FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant ON graph_node USING (workspace_id = (SELECT current_workspace_id()));
        CREATE POLICY tenant ON graph_edge USING (workspace_id = (SELECT current_workspace_id()));
        INSERT INTO graph_node VALUES ('n1','ws_a','Concept'),('n2','ws_a','Concept'),('n3','ws_a','Source'),('n4','ws_b','Concept');
        INSERT INTO graph_edge VALUES ('e1','ws_a'),('e2','ws_b');
      `);
      try {
        const io = ioFor(app);
        // The runtime pool, so the policy above is what scopes the count — not the superuser.
        const exitCode = await runOps(
          ["graph-counts", "--workspace", "ws_a"],
          app.database.pool,
          io,
        );

        expect(exitCode).toBe(0);
        expect(JSON.parse(io.lines[0] ?? "")).toEqual({
          nodes: { Concept: 2, Source: 1 },
          edges: 1,
        });
      } finally {
        await superuser.query("DROP TABLE graph_node; DROP TABLE graph_edge");
      }
    });
  });

  describe("smoke — the platform answers through its interface", () => {
    it("passes against the running app: health, the protected-resource document, the bearer challenge, the shell", async () => {
      const run = await ops(app, ["smoke", "--url", PUBLIC_URL, "--find", "--guide", "--ask"]);

      expect(run.lines.filter((line) => line.startsWith("FAIL"))).toEqual([]);
      expect(run.exitCode).toBe(0);
      expect(run.lines.filter((line) => line.startsWith("ok  "))).toHaveLength(4);
      // The three entries are named and honestly deferred, never reported as passed.
      expect(run.lines.filter((line) => line.startsWith("note "))).toHaveLength(3);
    });

    it("fails when the surface does not answer", async () => {
      const run = await ops(app, ["smoke", "--url", "https://nowhere.example.test"]);

      expect(run.exitCode).toBe(1);
    });
  });

  describe("dump-grep — present or absent per token, never the line", () => {
    it("reports each token's presence over a plain-SQL dump on stdin and quotes nothing", async () => {
      const dump =
        "COPY person (id, email) FROM stdin;\n1\tjane@example.test\n2\tother@example.test\n\\.\n";
      const run = await ops(
        app,
        ["dump-grep", "--tokens", "jane@example.test,nobody@example.test"],
        dump,
      );

      expect(run.exitCode).toBe(0);
      expect(run.lines).toEqual(["jane…st: present in 1 line(s)", "nobo…st: absent"]);
      expect(run.lines.join("\n")).not.toContain("other@example.test");
    });
  });
});
