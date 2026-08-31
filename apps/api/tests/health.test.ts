import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createServer } from "../src/server.ts";
import { startTestDatabase, type TestDatabase } from "./postgres.ts";

describe("the app's health endpoint", () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await startTestDatabase();
  });

  afterAll(async () => {
    await database.stop();
  });

  it("tells the deploy unit the app is healthy while the platform database answers", async () => {
    const server = createServer({ database: database.pool });

    const response = await server.request("/health");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "healthy",
      database: "reachable",
    });
  });

  it("tells the deploy unit the app is unhealthy when the platform database cannot be reached", async () => {
    // `worker` waits on `app` being healthy, so an app that cannot reach Postgres
    // must fail its healthcheck rather than let the stack come up around it.
    const unreachable = new Pool({
      connectionString: "postgresql://nobody@127.0.0.1:1/nothing",
      connectionTimeoutMillis: 1_000,
    });
    const server = createServer({ database: unreachable });

    const response = await server.request("/health");

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: "unhealthy",
      database: "unreachable",
    });
    await unreachable.end();
  });
});
