import { describe, expect, it } from "vitest";

import { authOver } from "./auth-instance.ts";
import { startApp } from "./harness.ts";

describe("a TestApp as the harness starts it", () => {
  it("lets a second authorization server start over its database", async () => {
    const app = await startApp();
    try {
      const second = authOver(app).$context.then(() => "ready");

      await expect(second).resolves.toBe("ready");
      expect(await (await app.server.request("/health")).json()).toMatchObject({
        identity: "ready",
      });
    } finally {
      await app.stop();
    }
  });
});
