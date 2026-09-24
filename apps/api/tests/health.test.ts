import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startApp, type TestApp } from "./harness.ts";
import { serverFor } from "./harness.ts";

const PROMOTED = "sha256:4c0ffee5d1a7e2b9f8c3a6d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4";

describe("the api's health endpoint", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await startApp();
  });

  afterAll(async () => {
    await app.stop();
  });

  it("tells the deploy unit the api is healthy while the platform database answers", async () => {
    const response = await app.server.request("/health");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "healthy",
      database: "reachable",
    });
  });

  it("names the image the api was started from, so a release can tell the build it promoted is the one answering", async () => {
    const server = serverFor(app.database.pool, { imageDigest: PROMOTED });

    const response = await server.request("/health");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "healthy",
      database: "reachable",
      identity: "ready",
      image: PROMOTED,
    });
  });

  it("says no image was named when the api was started without one, rather than inventing a digest", async () => {
    const response = await app.server.request("/health");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "healthy",
      database: "reachable",
      identity: "ready",
      image: null,
    });
  });

  it("tells the deploy unit the api is unhealthy when the platform database cannot be reached, naming the image that is failing", async () => {
    const unreachable = new Pool({
      connectionString: "postgresql://nobody@127.0.0.1:1/nothing",
      connectionTimeoutMillis: 1_000,
    });
    const server = serverFor(unreachable, { imageDigest: PROMOTED });

    const response = await server.request("/health");

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      status: "unhealthy",
      database: "unreachable",
      image: PROMOTED,
    });
    await unreachable.end();
  });

  it("tells the deploy unit the api is unhealthy when the database answers but the identity provider could not start", async () => {
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
