import { DatabaseError } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { authOver } from "./auth-instance.ts";
import { MCP_URL, startApp, type TestApp } from "./harness.ts";

describe("the identity adapter's create", () => {
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

  it("rejects a unique violation with the store's own error", async () => {
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

  it("keeps Drizzle's wrapper on a refusal other than uniqueness", async () => {
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
