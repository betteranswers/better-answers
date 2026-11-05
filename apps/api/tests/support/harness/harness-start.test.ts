import { describe, expect, it } from "vitest";

import { authOver } from "../auth-instance.ts";
import { startApp } from "./harness.ts";

describe("a TestApp started by the harness", () => {
  it("lets a second auth instance start on the same database", async () => {
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
