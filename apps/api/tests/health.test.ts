import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startApp, type TestApp } from "./harness.ts";
import { serverFor } from "./harness.ts";

describe("the app's health endpoint", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await startApp();
  });

  afterAll(async () => {
    await app.stop();
  });

  it("tells the deploy unit the app is healthy while the platform database answers", async () => {
    const response = await app.server.request("/health");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "healthy",
      database: "reachable",
    });
  });

  it("tells the deploy unit the app is unhealthy when the platform database cannot be reached", async () => {
    const unreachable = new Pool({
      connectionString: "postgresql://nobody@127.0.0.1:1/nothing",
      connectionTimeoutMillis: 1_000,
    });
    const server = serverFor(unreachable);

    const response = await server.request("/health");

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      status: "unhealthy",
      database: "unreachable",
    });
    await unreachable.end();
  });

  it("tells the deploy unit the app is unhealthy when the database answers but the identity provider could not start", async () => {
    await app.database.superuser.query("DROP DATABASE IF EXISTS unmigrated");
    await app.database.superuser.query("CREATE DATABASE unmigrated");
    const connection = new URL(String(app.database.superuser.options.connectionString));
    connection.pathname = "/unmigrated";
    const bare = new Pool({ connectionString: connection.href });
    try {
      const server = serverFor(bare);

      const response = await server.request("/health");

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({
        status: "unhealthy",
        database: "reachable",
        identity: "failed",
      });
    } finally {
      await bare.end();
      await app.database.superuser.query("DROP DATABASE IF EXISTS unmigrated");
    }
  });
});
