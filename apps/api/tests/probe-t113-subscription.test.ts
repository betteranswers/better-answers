import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TRPC_ENDPOINT } from "../src/trpc/mount.ts";
import { signIn } from "./flow.ts";
import { APP_HOSTNAME, startApp, type TestApp } from "./harness.ts";

/**
 * PROBE — THROWAWAY (T-113, probe 2 of 4; route spec, Further Notes). Never merged.
 *
 * The question (stub-slices F1): an async-generator tRPC subscription under
 * `workspaceProcedure` — does its body, which runs after the resolver returned and
 * `withPrincipal` committed and released the client, **fail outright** on that released
 * client, or **run on it** outside any transaction and outside the workspace's scope?
 * Either answer confirms the plan · draft · record split; the answer shapes the wrapper
 * (what `workspaceProcedure` must do for a subscription).
 *
 * The router carries a throwaway `probe.stream` for this file alone (`router.ts`).
 */

let app: TestApp;

beforeAll(async () => {
  app = await startApp();
});

afterAll(async () => {
  await app.stop();
});

const eventsOf = (sse: string): unknown[] =>
  sse
    .split("\n")
    .filter((line) => line.startsWith("data:") && line.slice("data:".length).trim() !== "")
    .map((line) => {
      const payload = line.slice("data:".length).trim();
      try {
        return JSON.parse(payload) as unknown;
      } catch {
        return { unparsed: payload };
      }
    });

describe("probe 2: an async-generator subscription under workspaceProcedure", () => {
  it("shows what the generator's tx is once the resolver has returned", async () => {
    const workspace = await app.provision();
    const client = app.client(undefined, APP_HOSTNAME);
    await signIn(app, client, workspace.admin.email);

    const pool = app.database.pool;
    const before = { idle: pool.idleCount, total: pool.totalCount };

    const response = await client.fetch(`${TRPC_ENDPOINT}/probe.stream`, {
      headers: { accept: "text/event-stream" },
    });
    const status = response.status;
    const contentType = response.headers.get("content-type");
    const body = await response.text();
    console.log("[probe-2] status:", status, "content-type:", contentType);
    console.log("[probe-2] raw body:\n" + body);
    const events = eventsOf(body);
    console.log("[probe-2] pool before:", before, "after:", {
      idle: pool.idleCount,
      total: pool.totalCount,
    });
    console.log("[probe-2] events:", JSON.stringify(events, null, 2));

    expect(status).toBe(200);
    expect(contentType).toContain("text/event-stream");
    expect(events.length).toBeGreaterThan(0);

    const planned = await client.fetch(`${TRPC_ENDPOINT}/probe.planned`, {
      headers: { accept: "text/event-stream" },
    });
    const plannedBody = await planned.text();
    console.log("[probe-2] planned status:", planned.status);
    console.log("[probe-2] planned events:", JSON.stringify(eventsOf(plannedBody), null, 2));
    expect(planned.status).toBe(200);
  });
});
