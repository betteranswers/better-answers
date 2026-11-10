import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { rootsOf } from "@better-answers/schema/testing/roots";

import { POSTGRES_IMAGE } from "../../../src/postgres-image.ts";
import { POSTGRES_COMMAND } from "../harness.ts";
import { sharedUri } from "../warm-postgres.ts";
import { POINTS_THE_WAY_UP, pointsTheWayUp, run, startInChild } from "./child.ts";
import { adminUri, asAdmin, quoted } from "./server.ts";

const { repositoryRoot } = rootsOf(import.meta.url);

const refusesFor = (started: Awaited<ReturnType<typeof startInChild>>, cause: string) => ({
  ...pointsTheWayUp(started),
  namesTheCause: started.failure?.includes(cause),
});

const REFUSES_FOR_THE_CAUSE = { ...POINTS_THE_WAY_UP, namesTheCause: true };

describe("the warm harness under TEST_POSTGRES_URI", () => {
  it("names the locator and the up command when unreachable", async () => {
    const started = await startInChild("postgres://nobody:nothing@127.0.0.1:1/postgres");

    expect(pointsTheWayUp(started)).toEqual(POINTS_THE_WAY_UP);
  });

  it("refuses a locator that signs in without superuser", async () => {
    const role = `not_super_${String(process.pid)}`;
    await asAdmin((admin) => admin.query(`CREATE ROLE ${quoted(role)} LOGIN PASSWORD 'not-super'`));
    try {
      const locator = new URL(adminUri());
      locator.username = role;
      locator.password = "not-super";

      expect(pointsTheWayUp(await startInChild(locator.toString()))).toEqual(POINTS_THE_WAY_UP);
    } finally {
      await asAdmin((admin) => admin.query(`DROP ROLE ${quoted(role)}`));
    }
  });
});

const OTHER_IMAGE = `other/image:tag@sha256:${"0".repeat(64)}`;

const MISMATCH = `stamped ${OTHER_IMAGE} but this checkout pins ${POSTGRES_IMAGE}`;

const throwawayPostgres = (command: readonly string[]): Promise<StartedPostgreSqlContainer> =>
  new PostgreSqlContainer(POSTGRES_IMAGE)
    .withUsername("postgres")
    .withPassword("postgres")
    .withCommand([...command])
    .start();

const scriptUriLineForThePin = async (): Promise<string | undefined> => {
  const printed = await run("bash", ["deploy/test-postgres.sh", "address"], {
    cwd: repositoryRoot,
    env: { ...process.env, TEST_POSTGRES_IMAGE: undefined },
  });
  const line = printed.stdout.split("\n").find((printedLine) => printedLine.startsWith("uri "));
  return line?.slice("uri ".length);
};

describe("the warm harness under TEST_POSTGRES_URI=shared", () => {
  let unstamped: StartedPostgreSqlContainer | undefined;
  let stampedOther: StartedPostgreSqlContainer | undefined;
  let stampedOurs: StartedPostgreSqlContainer | undefined;

  beforeAll(async () => {
    [unstamped, stampedOther, stampedOurs] = await Promise.all([
      throwawayPostgres(POSTGRES_COMMAND),
      throwawayPostgres([...POSTGRES_COMMAND, "-c", `better_answers.image=${OTHER_IMAGE}`]),
      throwawayPostgres([...POSTGRES_COMMAND, "-c", `better_answers.image=${POSTGRES_IMAGE}`]),
    ]);
  }, 300_000);

  afterAll(async () => {
    await Promise.all([unstamped?.stop(), stampedOther?.stop(), stampedOurs?.stop()]);
  });

  const running = (
    container: StartedPostgreSqlContainer | undefined,
  ): StartedPostgreSqlContainer => {
    if (container === undefined) throw new Error("the throwaway server never started");
    return container;
  };
  const portOf = (container: StartedPostgreSqlContainer | undefined): Record<string, string> => ({
    TEST_POSTGRES_PORT: String(running(container).getPort()),
  });

  it("derives the address the script prints", async () => {
    expect(sharedUri()).toBe(await scriptUriLineForThePin());
  });

  it("accepts a server stamped with the pinned image", async () => {
    const started = await startInChild("shared", portOf(stampedOurs));

    expect({ failure: started.failure, source: started.source }).toEqual({
      failure: undefined,
      source: "shared",
    });
  });

  it("refuses an unstamped server under shared", async () => {
    const started = await startInChild("shared", portOf(unstamped));

    expect(refusesFor(started, "no image stamp")).toEqual(REFUSES_FOR_THE_CAUSE);
  });

  it("refuses another image's server under shared", async () => {
    const started = await startInChild("shared", portOf(stampedOther));

    expect(refusesFor(started, MISMATCH)).toEqual(REFUSES_FOR_THE_CAUSE);
  });

  it("refuses another image's server under an explicit URI", async () => {
    const started = await startInChild(running(stampedOther).getConnectionUri());

    expect(refusesFor(started, MISMATCH)).toEqual(REFUSES_FOR_THE_CAUSE);
  });
});
