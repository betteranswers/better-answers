import { describe, expect, it } from "vitest";

import { readBootstrap } from "../src/config.ts";

describe("the app's bootstrap configuration", () => {
  it("reads the database URL and the port the deploy unit sets", () => {
    const bootstrap = readBootstrap({
      DATABASE_URL: "postgresql://app@platform:5432/better_answers",
      PORT: "3000",
      NODE_ENV: "production",
    });

    expect(bootstrap).toEqual({
      ok: true,
      value: {
        databaseUrl: "postgresql://app@platform:5432/better_answers",
        port: 3000,
        nodeEnv: "production",
      },
    });
  });

  it("listens on 3000 when the deploy unit sets no port", () => {
    const bootstrap = readBootstrap({
      DATABASE_URL: "postgresql://app@platform:5432/better_answers",
    });

    expect(bootstrap.ok && bootstrap.value.port).toBe(3000);
  });

  it("refuses to start rather than run without a database URL", () => {
    const bootstrap = readBootstrap({});

    expect(bootstrap.ok).toBe(false);
    expect(bootstrap.ok === false && bootstrap.error.message).toContain("DATABASE_URL");
  });
});
