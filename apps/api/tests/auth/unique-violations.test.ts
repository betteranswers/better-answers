import { DatabaseError } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { authOver } from "../support/auth-instance.ts";
import { MCP_URL, startApp, type TestApp } from "../support/harness/harness.ts";

describe("creating a row through the Better Auth adapter", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await startApp();
  });

  afterAll(async () => {
    await app.stop();
  });

  const refusalOf = async (model: string, data: Record<string, unknown>) => {
    const { adapter } = await authOver(app).$context;
    return adapter.create({ model, data }).then(
      () => undefined,
      (error: unknown) => error,
    );
  };

  it("throws pg's DatabaseError for a unique violation", async () => {
    const now = new Date();
    const refused = await refusalOf("oauthResource", {
      identifier: MCP_URL,
      name: MCP_URL,
      createdAt: now,
      updatedAt: now,
    });

    expect(refused).toBeInstanceOf(DatabaseError);
    expect(refused).toHaveProperty("code", "23505");
  });

  it("keeps Drizzle's error wrapper for a foreign-key violation", async () => {
    const refused = await refusalOf("oauthClientResource", {
      clientId: "no-such-assistant",
      resourceId: MCP_URL,
      createdAt: new Date(),
    });

    expect(refused).toBeInstanceOf(Error);
    expect(refused).not.toBeInstanceOf(DatabaseError);
    expect(refused).toHaveProperty("cause.code", "23503");
  });
});
