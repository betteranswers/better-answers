import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { capturingLogger, serverFor, startApp, type TestApp } from "./harness.ts";
import { startTestDatabase } from "./postgres.ts";

const PROMOTED = "sha256:4c0ffee5d1a7e2b9f8c3a6d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4";

describe("the api's health endpoint", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await startApp();
  });

  afterAll(async () => {
    await app.stop();
  });

  it("reports healthy while the platform database answers", async () => {
    const response = await app.server.request("/health");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "healthy",
      database: "reachable",
    });
  });

  it("names its image, so a release sees the promoted build", async () => {
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

  it("says no image was named rather than inventing a digest", async () => {
    const response = await app.server.request("/health");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "healthy",
      database: "reachable",
      identity: "ready",
      image: null,
    });
  });

  it("reports unhealthy, naming the image, when the database is unreachable", async () => {
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

  it("reports unhealthy when the identity provider could not start", async () => {
    await app.database.superuser.query("DROP DATABASE IF EXISTS unmigrated");
    await app.database.superuser.query("CREATE DATABASE unmigrated");
    const connection = new URL(String(app.database.superuser.options.connectionString));
    connection.pathname = "/unmigrated";
    const bare = new Pool({ connectionString: connection.href });
    const { logger, logs } = capturingLogger();
    try {
      const server = serverFor(bare, { logger });

      const response = await server.request("/health");

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({
        status: "unhealthy",
        database: "reachable",
        identity: "failed",
      });
      expect(logs).toContainEqual(
        expect.objectContaining({
          level: 50,
          msg: "the authorization server failed to initialise",
          reason: expect.any(String),
        }),
      );
    } finally {
      await bare.end();
      await app.database.superuser.query("DROP DATABASE IF EXISTS unmigrated");
    }
  });
});

describe("two apis starting together over one fresh database", () => {
  it("both start healthy when each inserts the MCP resource", async () => {
    const database = await startTestDatabase();
    const holder = await database.superuser.connect();
    try {
      // SHARE lets each api read the missing row but holds back its insert, so both race.
      await holder.query("BEGIN");
      await holder.query("LOCK TABLE oauth_resource IN SHARE MODE");
      const servers = [serverFor(database.pool), serverFor(database.pool)];
      await vi.waitFor(
        async () => {
          const waiting = await database.superuser.query<{ count: number }>(
            "SELECT count(*)::int AS count FROM pg_locks WHERE NOT granted AND relation = 'oauth_resource'::regclass",
          );
          expect(waiting.rows[0]?.count).toBe(servers.length);
        },
        { timeout: 10_000, interval: 20 },
      );
      await holder.query("COMMIT");

      const answers = await Promise.all(
        servers.map(async (server) => (await server.request("/health")).json()),
      );

      expect(answers).toEqual([
        expect.objectContaining({ status: "healthy", identity: "ready" }),
        expect.objectContaining({ status: "healthy", identity: "ready" }),
      ]);
    } finally {
      // Destroyed, so a wait that timed out takes its lock with it.
      holder.release(true);
      await database.stop();
    }
  });
});
