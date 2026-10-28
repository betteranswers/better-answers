import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { repositoryRoot } from "@better-answers/devtools/paths";
import { POSTGRES_IMAGE } from "@better-answers/schema";
import { matching } from "@better-answers/schema/testing/matching";

import { freePort } from "../support/loopback-port.ts";
import {
  containersOf,
  imagesOf,
  inspected,
  outcomeOf,
  type Run,
  runScript,
  upOnATakenPort,
  volumesOf,
} from "./compose-project.ts";

const script = path.join(repositoryRoot, "deploy/test-postgres.sh");
const composeFile = path.join(repositoryRoot, "deploy/test-postgres.compose.yaml");

const stem = `ba-test-postgres-test-${String(process.pid)}`;

const INHERITED_PATH = process.env["PATH"] ?? "";

const projectOf = (stemName: string): string => {
  const digest = /@sha256:([0-9a-f]{64})$/.exec(POSTGRES_IMAGE)?.[1];
  if (digest === undefined) throw new Error("POSTGRES_IMAGE carries no digest");
  return `${stemName}-${digest.slice(0, 12)}`;
};

const project = projectOf(stem);

const testPostgres = (port: number, argv: readonly string[], stemName: string = stem): Run =>
  runScript(script, argv, {
    TEST_POSTGRES_PROJECT: stemName,
    TEST_POSTGRES_PORT: String(port),
  });

const uriOn = (port: number): string =>
  `postgresql://postgres:postgres@127.0.0.1:${String(port)}/postgres`;

const composeUp = (projectName: string, port: number, image: string = POSTGRES_IMAGE): void => {
  execFileSync("docker", ["compose", "-f", composeFile, "-p", projectName, "up", "-d"], {
    env: { ...process.env, TEST_POSTGRES_IMAGE: image, TEST_POSTGRES_PORT: String(port) },
    stdio: "ignore",
  });
};

const composeDown = (projectName: string): void => {
  execFileSync("docker", ["compose", "-p", projectName, "down"], { stdio: "ignore" });
};

let port: number;
let upFirst: Run;

const queried = async <Row extends pg.QueryResultRow>(sql: string): Promise<Row[]> => {
  const client = new pg.Client({ connectionString: uriOn(port) });
  await client.connect();
  try {
    return (await client.query<Row>(sql)).rows;
  } finally {
    await client.end();
  }
};

const onlyContainer = (projectName: string): string => {
  const [container] = containersOf(projectName);
  if (container === undefined) throw new Error(`${projectName} has no container`);
  return container;
};

beforeAll(async () => {
  port = await freePort();
  upFirst = testPostgres(port, ["up"]);
});

afterAll(() => {
  testPostgres(port, ["down", "--all"]);
});

describe("the shared test postgres's address", () => {
  it("prints its address without calling Docker", () => {
    const shims = mkdtempSync(path.join(tmpdir(), "ba-test-postgres-shims-"));
    const called = path.join(shims, "docker-called");
    writeFileSync(path.join(shims, "docker"), `#!/bin/sh\ntouch '${called}'\nexit 97\n`);
    chmodSync(path.join(shims, "docker"), 0o755);
    try {
      const run = runScript(script, ["address"], {
        PATH: `${shims}${path.delimiter}${INHERITED_PATH}`,
        TEST_POSTGRES_PROJECT: stem,
        TEST_POSTGRES_PORT: "54999",
      });
      expect({ status: run.status, stdout: run.stdout, called: existsSync(called) }).toEqual({
        status: 0,
        stdout: `project ${project}\nuri ${uriOn(54999)}\n`,
        called: false,
      });
    } finally {
      rmSync(shims, { recursive: true, force: true });
    }
  });

  it("derives a separate project and port per image digest", () => {
    const addressOf = (digestLead: string): string =>
      runScript(script, ["address"], {
        TEST_POSTGRES_IMAGE: `pgvector/pgvector:0.8.6-pg18-trixie@sha256:${digestLead.padEnd(64, "0")}`,
        TEST_POSTGRES_PROJECT: stem,
        TEST_POSTGRES_PORT: "",
      }).stdout;
    expect([addressOf("abcdef012345"), addressOf("0123456789ab")]).toEqual([
      `project ${stem}-abcdef012345\nuri ${uriOn(56415)}\n`,
      `project ${stem}-0123456789ab\nuri ${uriOn(55725)}\n`,
    ]);
  });
});

describe("the shared test postgres", () => {
  it("starts on its loopback port, printing the variable to export", () => {
    expect(outcomeOf(upFirst)).toEqual("ran");
    expect(upFirst.stdout.split("\n")).toEqual(
      matching.arrayContaining([
        `test-postgres: up on 127.0.0.1:${String(port)}; point the test suites at it with:`,
        "export TEST_POSTGRES_URI=shared",
      ]),
    );
    expect(upFirst.stdout).toContain("deploy/test-postgres.sh down");
  });

  it("names a port moved off the derived one", () => {
    expect(upFirst.stdout.split("\n")).toContain(`export TEST_POSTGRES_PORT=${String(port)}`);
  });

  it("signs the printed URI in as a superuser", async () => {
    expect(await queried("SELECT rolsuper FROM pg_roles WHERE rolname = current_user")).toEqual([
      { rolsuper: true },
    ]);
  });

  it("runs the one pinned image, by digest", () => {
    expect(imagesOf(project)).toEqual([POSTGRES_IMAGE]);
  });

  it("stamps the server with the pinned image", async () => {
    expect(await queried("SELECT current_setting('better_answers.image', true) AS image")).toEqual([
      { image: POSTGRES_IMAGE },
    ]);
  });

  it("runs without durability, as the suites' own servers do", async () => {
    expect(
      await queried(`SELECT current_setting('fsync') AS fsync,
                            current_setting('synchronous_commit') AS synchronous_commit,
                            current_setting('full_page_writes') AS full_page_writes,
                            current_setting('max_connections') AS max_connections`),
    ).toEqual([
      { fsync: "off", synchronous_commit: "off", full_page_writes: "off", max_connections: "800" },
    ]);
  });

  it("caps its WAL at the pinned size", async () => {
    expect(await queried("SELECT current_setting('max_wal_size') AS max_wal_size")).toEqual([
      { max_wal_size: "512MB" },
    ]);
  });

  it("starts nothing new when already up", () => {
    const container = onlyContainer(project);
    const startedAt = inspected(container, "{{.State.StartedAt}}");
    const again = testPostgres(port, ["up"]);
    expect(outcomeOf(again)).toEqual("ran");
    expect(again.stdout.split("\n")).toContain("export TEST_POSTGRES_URI=shared");
    expect({
      containers: containersOf(project),
      startedAt: inspected(container, "{{.State.StartedAt}}"),
    }).toEqual({ containers: [container], startedAt });
  });

  it("refuses another image, leaving that container running", async () => {
    const otherStem = `${stem}-other`;
    const elsewhere = projectOf(otherStem);
    const otherPort = await freePort();
    const otherImage = `ba-test-postgres-other:${String(process.pid)}`;
    execFileSync("docker", ["tag", POSTGRES_IMAGE, otherImage]);
    try {
      composeUp(elsewhere, otherPort, otherImage);
      const running = onlyContainer(elsewhere);

      const run = testPostgres(otherPort, ["up"], otherStem);
      expect({ status: run.status, stderr: run.stderr }).toEqual({
        status: 1,
        stderr: matching.stringContaining("deploy/test-postgres.sh down, then up"),
      });
      expect({
        containers: containersOf(elsewhere),
        image: inspected(running, "{{.Config.Image}}"),
        state: inspected(running, "{{.State.Status}}"),
      }).toEqual({ containers: [running], image: otherImage, state: "running" });
    } finally {
      testPostgres(otherPort, ["down"], otherStem);
      execFileSync("docker", ["rmi", otherImage], { stdio: "ignore" });
    }
  }, 180_000);

  it("refuses a port already in use, and starts nothing", async () => {
    const takenStem = `${stem}-taken`;
    expect(
      await upOnATakenPort((taken) => testPostgres(taken, ["up"], takenStem), projectOf(takenStem)),
    ).toEqual({ status: 1, containers: [], namesThePort: true });
  });

  it("carries no testcontainers label, so the reaper never lists it", () => {
    const container = onlyContainer(project);
    const reapable = execFileSync(
      "docker",
      ["ps", "--all", "--no-trunc", "-q", "--filter", "label=org.testcontainers=true"],
      { encoding: "utf8" },
    );
    expect({
      labels: Object.keys(
        z
          .record(z.string(), z.string())
          .parse(JSON.parse(inspected(container, "{{json .Config.Labels}}"))),
      ).filter((label) => label.startsWith("org.testcontainers")),
      listed: reapable.split("\n").some((listed) => listed.startsWith(container)),
    }).toEqual({ labels: [], listed: false });
  });

  it("keeps its data in memory, so down discards every database", async () => {
    await queried("CREATE DATABASE made_before_down");
    expect({
      mounts: inspected(
        onlyContainer(project),
        "{{range .Mounts}}{{.Type}}:{{.Destination}} {{end}}",
      ),
      volumes: volumesOf(project),
    }).toEqual({ mounts: "tmpfs:/var/lib/postgresql", volumes: [] });

    const down = testPostgres(port, ["down"]);
    expect({ status: down.status, containers: containersOf(project) }).toEqual({
      status: 0,
      containers: [],
    });
    expect(outcomeOf(testPostgres(port, ["up"]))).toEqual("ran");
    expect(
      await queried("SELECT datname FROM pg_database WHERE datname = 'made_before_down'"),
    ).toEqual([]);
  }, 180_000);
});

describe("the shared test postgres's servers under one stem", () => {
  const allStem = `${stem}-all`;
  const outsider = `${allStem}-0123456789abcd`;
  let allPort: number;
  let upBeside: Run;

  beforeAll(async () => {
    composeUp(allStem, await freePort());
    composeUp(outsider, await freePort());
    allPort = await freePort();
    upBeside = testPostgres(allPort, ["up"], allStem);
  });

  afterAll(() => {
    testPostgres(allPort, ["down", "--all"], allStem);
    composeDown(outsider);
  });

  it("names the other servers still running under its stem", () => {
    expect(outcomeOf(upBeside)).toEqual("ran");
    expect(upBeside.stdout.split("\n")).toContain(
      `test-postgres: also running: ${allStem} — deploy/test-postgres.sh down --all clears them`,
    );
  });

  it("stops every server under its stem, and only those", () => {
    const down = testPostgres(allPort, ["down", "--all"], allStem);
    expect({
      status: down.status,
      underStem: [...containersOf(allStem), ...containersOf(projectOf(allStem))],
      outsider: containersOf(outsider).map((container) =>
        inspected(container, "{{.State.Status}}"),
      ),
    }).toEqual({ status: 0, underStem: [], outsider: ["running"] });
  }, 180_000);
});
