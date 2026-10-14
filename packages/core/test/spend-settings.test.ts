import { describe, expect, it } from "vitest";

import { ulid } from "@better-answers/schema";

import type { PlatformPrincipal } from "../src/kernel/index.ts";
import { setModelPrice } from "../src/llm/index.ts";
import { openPostgres } from "../src/store/postgres/index.ts";
import { setSpendingLimit } from "../src/workspaces/index.ts";
import { provisionedWorkspace } from "./platform.ts";
import { postgresForSuite, whileWritesAreRefused } from "./suite-postgres.ts";

const db = postgresForSuite();

const PLATFORM: PlatformPrincipal = {
  kind: "platform",
  actorId: "process:better-answers-bootstrap",
};

const limiting = (workspaceId: string, usd: string) =>
  setSpendingLimit(PLATFORM, openPostgres(db().pool), { workspaceId, usd });

const pricing = (overrides: { readonly provider?: string; readonly effectiveFrom?: string } = {}) =>
  setModelPrice(PLATFORM, openPostgres(db().pool), {
    provider: "anthropic",
    model: "claude-sonnet-5-5",
    effectiveFrom: "2026-10-14",
    usdPerMillionIn: "3",
    usdPerMillionOut: "15",
    ...overrides,
  });

const limitsStored = async (workspaceId: string) => {
  const read = await db().pool.query(
    "SELECT key, value FROM workspace_config WHERE workspace_id = $1 AND key LIKE 'llm.%'",
    [workspaceId],
  );
  return read.rows;
};

describe("a workspace's spending limit", () => {
  it("is stored under its key as the dollars given", async () => {
    const { workspaceId } = await provisionedWorkspace(db(), "Limited");

    expect(await limiting(workspaceId, "12.50")).toEqual({
      ok: true,
      value: { workspaceId, usd: "12.50" },
    });
    expect(await limitsStored(workspaceId)).toEqual([
      { key: "llm.spending_limit_usd", value: "12.50" },
    ]);
  });

  it.each(["fifty", "x1", "1x", "1.1234567"])("refuses %s as malformed", async (usd) => {
    const { workspaceId } = await provisionedWorkspace(db(), "Limited");

    expect(await limiting(workspaceId, usd)).toEqual({ ok: false, error: "malformed" });
    expect(await limitsStored(workspaceId)).toEqual([]);
  });

  it("refuses a workspace that does not exist", async () => {
    expect(await limiting(ulid(), "50")).toEqual({ ok: false, error: "no-such-workspace" });
  });

  it("answers the store's failure and sets nothing", async () => {
    const { workspaceId } = await provisionedWorkspace(db(), "Limited");

    const refused = await whileWritesAreRefused(db().pool, "workspace_config", () =>
      limiting(workspaceId, "50"),
    );

    expect(refused.ok ? "set" : refused.error).toBeInstanceOf(Error);
    expect(await limitsStored(workspaceId)).toEqual([]);
  });
});

describe("a model's price", () => {
  it("answers what it priced, from which day", async () => {
    expect(await pricing()).toEqual({
      ok: true,
      value: { provider: "anthropic", model: "claude-sonnet-5-5", effectiveFrom: "2026-10-14" },
    });
  });

  it.each([
    ["a day the calendar lacks", { effectiveFrom: "2026-02-30" }],
    ["a provider outside the two", { provider: "openai" }],
  ])("refuses %s as malformed", async (_shape, overrides) => {
    expect(await pricing(overrides)).toEqual({ ok: false, error: "malformed" });
  });

  it("answers the store's failure", async () => {
    const refused = await whileWritesAreRefused(db().pool, "model_price", () => pricing());

    expect(refused.ok ? "set" : refused.error).toBeInstanceOf(Error);
  });
});
