import { execFileSync } from "node:child_process";
import path from "node:path";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { repositoryRoot } from "@better-answers/devtools/paths";
import { POSTGRES_IMAGE } from "@better-answers/schema";

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
import { freePort } from "./loopback-port.ts";

const script = path.join(repositoryRoot, "deploy/test-postgres.sh");
const composeFile = path.join(repositoryRoot, "deploy/test-postgres.compose.yaml");

/** Its own project and port, so a developer's shared instance is never the one this stops. */
const project = `ba-test-postgres-test-${String(process.pid)}`;

const testPostgres = (port: number, argv: readonly string[], projectName: string = project): Run =>
  runScript(script, argv, {
    TEST_POSTGRES_PROJECT: projectName,
    TEST_POSTGRES_PORT: String(port),
  });

const uriOn = (port: number): string =>
  `postgresql://postgres:postgres@127.0.0.1:${String(port)}/postgres`;

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
  testPostgres(port, ["down"]);
});

describe("the shared test postgres", () => {
  it("starts on its loopback port, printing the URI to export", () => {
    expect(outcomeOf(upFirst)).toEqual("ran");
    expect(upFirst.stdout.split("\n")).toContain(`export TEST_POSTGRES_URI=${uriOn(port)}`);
    expect(upFirst.stdout).toContain("deploy/test-postgres.sh down");
  });

  it("signs the printed URI in as a superuser", async () => {
    expect(await queried("SELECT rolsuper FROM pg_roles WHERE rolname = current_user")).toEqual([
      { rolsuper: true },
    ]);
  });

  it("runs the one pinned image, by digest", () => {
    expect(imagesOf(project)).toEqual([POSTGRES_IMAGE]);
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
    expect(again.stdout.split("\n")).toContain(`export TEST_POSTGRES_URI=${uriOn(port)}`);
    expect({
      containers: containersOf(project),
      startedAt: inspected(container, "{{.State.StartedAt}}"),
    }).toEqual({ containers: [container], startedAt });
  });

  it("refuses another image, leaving that container running", async () => {
    const elsewhere = `${project}-other`;
    const otherPort = await freePort();
    const otherImage = `ba-test-postgres-other:${String(process.pid)}`;
    execFileSync("docker", ["tag", POSTGRES_IMAGE, otherImage]);
    try {
      execFileSync("docker", ["compose", "-f", composeFile, "-p", elsewhere, "up", "-d"], {
        env: {
          ...process.env,
          TEST_POSTGRES_IMAGE: otherImage,
          TEST_POSTGRES_PORT: String(otherPort),
        },
        stdio: "ignore",
      });
      const running = onlyContainer(elsewhere);

      const run = testPostgres(otherPort, ["up"], elsewhere);
      expect({ status: run.status, stderr: run.stderr }).toEqual({
        status: 1,
        stderr: expect.stringContaining("deploy/test-postgres.sh down, then up"),
      });
      expect({
        containers: containersOf(elsewhere),
        image: inspected(running, "{{.Config.Image}}"),
        state: inspected(running, "{{.State.Status}}"),
      }).toEqual({ containers: [running], image: otherImage, state: "running" });
    } finally {
      testPostgres(otherPort, ["down"], elsewhere);
      execFileSync("docker", ["rmi", otherImage], { stdio: "ignore" });
    }
  }, 180_000);

  it("refuses a port already in use, and starts nothing", async () => {
    expect(
      await upOnATakenPort((taken, name) => testPostgres(taken, ["up"], name), `${project}-taken`),
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
