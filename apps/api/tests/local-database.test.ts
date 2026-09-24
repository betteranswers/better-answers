import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { CONTRACT_DIGEST, POSTGRES_IMAGE } from "@better-answers/schema";
import { testData } from "@better-answers/schema/testing";

import { freePort, heldPort, released } from "./loopback-port.ts";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const script = path.join(repositoryRoot, "deploy/local-database.sh");
const readJson = (relative: string): unknown =>
  JSON.parse(readFileSync(path.join(repositoryRoot, relative), "utf8"));

const journal = z
  .object({ entries: z.array(z.object({ tag: z.string() })) })
  .parse(readJson("packages/schema/migrations/meta/_journal.json"));

const fixture = z
  .object({
    document: z.object({
      source_document_id: z.string(),
      binding_id: z.string(),
      chunks: z.array(
        z.object({
          id: z.string(),
          ordinal: z.number(),
          char_start: z.number(),
          char_end: z.number(),
          locator: z.string(),
          content: z.string(),
        }),
      ),
    }),
  })
  .parse(readJson("contracts/document-chunk/cases.json"));

const SYNTHETIC_WORKSPACE = "01M2SYNTHET1CAAAAAAAAAAAAA";

// Its own project and port, so a developer's own local database is never the one this stops.
const project = `ba-local-database-test-${String(process.pid)}`;

type Run = { readonly status: number | null; readonly stdout: string; readonly stderr: string };

// Compose narrates to stderr on success, so it is read only when the run failed.
const outcomeOf = (run: Run): string =>
  run.status === 0 ? "ran" : `exited ${String(run.status)}: ${run.stderr}`;

const localDatabase = (
  port: number,
  argv: readonly string[],
  projectName: string = project,
): Run => {
  const result = spawnSync("bash", [script, ...argv], {
    encoding: "utf8",
    env: {
      ...process.env,
      LOCAL_DATABASE_PROJECT: projectName,
      LOCAL_DATABASE_PORT: String(port),
    },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
};

const containersOf = (projectName: string): readonly string[] =>
  execFileSync(
    "docker",
    ["ps", "-a", "-q", "--filter", `label=com.docker.compose.project=${projectName}`],
    { encoding: "utf8" },
  )
    .split("\n")
    .filter((line) => line !== "");

const volumesOf = (projectName: string): readonly string[] =>
  execFileSync(
    "docker",
    ["volume", "ls", "-q", "--filter", `label=com.docker.compose.project=${projectName}`],
    { encoding: "utf8" },
  )
    .split("\n")
    .filter((line) => line !== "");

let port: number;
let upFirst: Run;

const signedInAs = (user: string, password: string): pg.Pool =>
  new pg.Pool({
    connectionString: `postgresql://${user}:${password}@127.0.0.1:${String(port)}/better_answers`,
    max: 1,
  });

beforeAll(async () => {
  port = await freePort();
  upFirst = localDatabase(port, ["up"]);
});

afterAll(() => {
  localDatabase(port, ["down", "--wipe"]);
});

describe("the local database", () => {
  it("comes up on the loopback port it names, and says how to stop it", () => {
    expect(outcomeOf(upFirst)).toEqual("ran");
    expect(upFirst.stdout).toContain(`127.0.0.1:${String(port)}`);
    expect(upFirst.stdout).toContain("deploy/local-database.sh down");
    expect(upFirst.stdout).toContain("--wipe");
  });

  it("names the synthetic workspace by its id as it seeds it, so an ops command can be pointed at it", () => {
    expect(upFirst.stdout).toContain(
      `synthetic fixture present: workspace ${SYNTHETIC_WORKSPACE}, slug synthetic`,
    );
  });

  it("runs the one pinned image, by digest", () => {
    const images = containersOf(project).map((container) =>
      execFileSync("docker", ["inspect", "--format", "{{.Config.Image}}", container], {
        encoding: "utf8",
      }).trim(),
    );
    expect(images).toEqual([POSTGRES_IMAGE]);
  });

  it("has the whole migration journal applied, and the contract stamped as migrate stamps it", async () => {
    const owner = signedInAs("better_answers", "better_answers");
    try {
      const applied = await owner.query<{ migrations: number }>(
        "SELECT count(*)::int AS migrations FROM drizzle.__drizzle_migrations",
      );
      expect(applied.rows).toEqual([{ migrations: journal.entries.length }]);
      const stamp = await owner.query("SELECT digest FROM contract_stamp");
      expect(stamp.rows).toEqual([{ digest: CONTRACT_DIGEST }]);
    } finally {
      await owner.end();
    }
  });

  describe("read as a GUI profile reads it, through the browsing role", () => {
    let browse: pg.Pool;

    beforeAll(() => {
      browse = signedInAs("browse_ro", "browse_ro");
    });

    afterAll(async () => {
      await browse.end();
    });

    it("holds one binding in the synthetic workspace, indexed and unpublished", async () => {
      const bindings = await browse.query(
        `SELECT id, connector, state, published_at FROM source_binding
          WHERE workspace_id = $1`,
        [SYNTHETIC_WORKSPACE],
      );
      expect(bindings.rows).toEqual([
        {
          id: "01M2B1ND1NGAAAAAAAAAAAAAAA",
          connector: "upload",
          state: "indexed",
          published_at: null,
        },
      ]);
    });

    it("holds the binding's one markdown document, converted, with no landed copy named", async () => {
      const documents = await browse.query(
        `SELECT id, binding_id, media_type, outcome, normalised_key, content_hash
           FROM source_document WHERE workspace_id = $1`,
        [SYNTHETIC_WORKSPACE],
      );
      expect(documents.rows).toEqual([
        {
          id: "01M2Q3R4S5T6V7W8X9YZAB0001",
          binding_id: "01M2B1ND1NGAAAAAAAAAAAAAAA",
          media_type: "text/markdown",
          outcome: "converted",
          normalised_key: null,
          content_hash: null,
        },
      ]);
    });

    it("holds the document's chunk rows as the document-chunk agreement's redacted case cuts them", async () => {
      const chunks = await browse.query(
        `SELECT id, binding_id, source_document_id, ordinal, char_start, char_end, locator, content
           FROM "index".chunk WHERE workspace_id = $1 ORDER BY ordinal`,
        [SYNTHETIC_WORKSPACE],
      );
      expect(chunks.rows).toEqual(
        fixture.document.chunks.map((chunk) => ({
          ...chunk,
          binding_id: fixture.document.binding_id,
          source_document_id: fixture.document.source_document_id,
        })),
      );
    });

    it("holds the redaction's placeholder where the sort code was, and no sort code anywhere", async () => {
      const held = await browse.query<{ text: string }>(
        `SELECT content AS text FROM "index".chunk WHERE workspace_id = $1
         UNION ALL
         SELECT concat_ws(' ', title, source_system_id, original_key) FROM source_document
          WHERE workspace_id = $1`,
        [SYNTHETIC_WORKSPACE],
      );
      const text = held.rows.map((row) => row.text).join("\n");
      expect(text).toContain("The sort code is [withheld]");
      expect(text).not.toMatch(/\b\d{2}[- ]?\d{2}[- ]?\d{2}\b/);
    });
  });

  describe("the synthetic seed, run where the local database runs it", () => {
    it("seeds from the drill's call, the owner DSN in STAGING_DATABASE_URL and no argument, adding no second copy", () => {
      const [container] = containersOf(project);
      const seeded = spawnSync(
        "docker",
        [
          "exec",
          "--env",
          "STAGING_DATABASE_URL=postgresql://better_answers:better_answers@127.0.0.1:5432/better_answers",
          container ?? "",
          "/repo/deploy/seed-synthetic.sh",
        ],
        { encoding: "utf8" },
      );
      expect({ status: seeded.status, stderr: seeded.stderr }).toEqual({ status: 0, stderr: "" });
      expect(seeded.stdout).toContain(
        `synthetic fixture present: workspace ${SYNTHETIC_WORKSPACE}, slug synthetic, 1 binding, 1 document, 3 chunks`,
      );
    });
  });

  it("keeps what it holds across a stop and a start, and a second up seeds no second copy", async () => {
    const owner = signedInAs("better_answers", "better_answers");
    let marker: string;
    const client = await owner.connect();
    try {
      marker = (await testData(client).workspace()).id;
    } finally {
      client.release();
      await owner.end();
    }

    const down = localDatabase(port, ["down"]);
    expect({ status: down.status, containers: containersOf(project) }).toEqual({
      status: 0,
      containers: [],
    });
    const again = localDatabase(port, ["up"]);
    expect(outcomeOf(again)).toEqual("ran");

    const reopened = signedInAs("browse_ro", "browse_ro");
    try {
      const held = await reopened.query(
        `SELECT (SELECT count(*)::int FROM workspace WHERE id = $1) AS marker,
                (SELECT count(*)::int FROM source_binding WHERE workspace_id = $2) AS bindings,
                (SELECT count(*)::int FROM source_document WHERE workspace_id = $2) AS documents,
                (SELECT count(*)::int FROM "index".chunk WHERE workspace_id = $2) AS chunks`,
        [marker, SYNTHETIC_WORKSPACE],
      );
      expect(held.rows).toEqual([{ marker: 1, bindings: 1, documents: 1, chunks: 3 }]);
    } finally {
      await reopened.end();
    }
  }, 180_000);

  it("refuses a port something else already listens on, and starts nothing", async () => {
    const held = await heldPort();
    const taken = held.port;
    const elsewhere = `${project}-taken`;
    try {
      const run = localDatabase(taken, ["up"], elsewhere);
      expect({ status: run.status, containers: containersOf(elsewhere) }).toEqual({
        status: 1,
        containers: [],
      });
      expect(run.stderr).toContain(`127.0.0.1:${String(taken)} is taken`);
    } finally {
      await released(held);
    }
  });

  it("refuses to seed over a synthetic fixture an earlier seed left under another id, and says to wipe", async () => {
    const owner = signedInAs("better_answers", "better_answers");
    const client = await owner.connect();
    let earlier: string;
    try {
      await client.query("UPDATE workspace SET slug = 'synthetic-now' WHERE id = $1", [
        SYNTHETIC_WORKSPACE,
      ]);
      earlier = (await testData(client).workspace({ slug: "synthetic" })).id;
    } finally {
      client.release();
      await owner.end();
    }

    const again = localDatabase(port, ["up"]);
    expect({ status: again.status, stderr: again.stderr }).toEqual({
      status: 1,
      stderr: expect.stringContaining(
        `local-database: REFUSED — this database holds the synthetic fixture under ${earlier}, and its workspace is ${SYNTHETIC_WORKSPACE} now — deploy/local-database.sh down --wipe, then up`,
      ),
    });
  }, 180_000);

  it("drops its data only when told to wipe it", () => {
    expect(volumesOf(project)).toHaveLength(1);
    const wiped = localDatabase(port, ["down", "--wipe"]);
    expect({
      status: wiped.status,
      containers: containersOf(project),
      volumes: volumesOf(project),
    }).toEqual({ status: 0, containers: [], volumes: [] });
  });
});
