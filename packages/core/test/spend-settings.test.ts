import { describe, expect, it } from "vitest";

import { ulid } from "@better-answers/schema";

import type { PlatformPrincipal } from "../src/kernel/index.ts";
import { openPostgres } from "../src/store/postgres/index.ts";
import { setDecisionThreshold, setModelPrice, setSpendingLimit } from "../src/workspaces/index.ts";
import { provisionedWorkspace } from "./platform.ts";
import { postgresForSuite, whileWritesAreRefused } from "./suite-postgres.ts";

const db = postgresForSuite();

const PLATFORM: PlatformPrincipal = {
  kind: "platform",
  actorId: "process:better-answers-bootstrap",
};

const limiting = (workspaceId: string, gbp: string) =>
  setSpendingLimit(PLATFORM, openPostgres(db().pool), { workspaceId, gbp });

const pricing = (
  overrides: {
    readonly provider?: string;
    readonly model?: string;
    readonly effectiveFrom?: string;
  } = {},
) =>
  setModelPrice(PLATFORM, openPostgres(db().pool), {
    provider: "anthropic",
    model: "claude-sonnet-5-5",
    effectiveFrom: "2026-10-14",
    gbpPerMillionIn: "3",
    gbpPerMillionOut: "15",
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
  it("is stored under its key as the pounds given", async () => {
    const { workspaceId } = await provisionedWorkspace(db(), "Limited");

    expect(await limiting(workspaceId, "12.50")).toEqual({
      ok: true,
      value: { workspaceId, gbp: "12.50" },
    });
    expect(await limitsStored(workspaceId)).toEqual([
      { key: "llm.spending_limit_gbp", value: "12.50" },
    ]);
  });

  it.each(["fifty", "x1", "1x", "1.1234567"])("refuses %s as malformed", async (gbp) => {
    const { workspaceId } = await provisionedWorkspace(db(), "Limited");

    expect(await limiting(workspaceId, gbp)).toEqual({ ok: false, error: "malformed" });
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

  it("records who priced which model, from when, at what rates", async () => {
    const model = `claude-priced-${ulid().toLowerCase()}`;
    await pricing({ model, effectiveFrom: "2026-11-01" });

    const recorded = await db().pool.query(
      `SELECT action, actor, subject_id, detail FROM identity_audit_event
        WHERE action = 'platform.model.priced' AND subject_id = $1`,
      [`anthropic/${model}`],
    );

    expect(recorded.rows).toEqual([
      {
        action: "platform.model.priced",
        actor: PLATFORM.actorId,
        subject_id: `anthropic/${model}`,
        detail: {
          provider: "anthropic",
          model,
          effectiveFrom: "2026-11-01",
          gbpPerMillionIn: "3",
          gbpPerMillionOut: "15",
        },
      },
    ]);
  });

  it.each([
    ["a day the calendar lacks", { effectiveFrom: "2026-02-30" }],
    ["a provider outside the two", { provider: "openai" }],
    ["a model name with capitals", { model: "sk-ant-API03 key" }],
  ])("refuses %s as malformed", async (_shape, overrides) => {
    expect(await pricing(overrides)).toEqual({ ok: false, error: "malformed" });
  });

  it("answers the store's failure", async () => {
    const refused = await whileWritesAreRefused(db().pool, "model_price", () => pricing());

    expect(refused.ok ? "set" : refused.error).toBeInstanceOf(Error);
  });
});

const aModel = () => `clef-${ulid().toLowerCase()}`;

const thresholding = (
  model: string,
  overrides: { readonly provider?: string; readonly model?: string; readonly threshold?: string },
) =>
  setDecisionThreshold(PLATFORM, openPostgres(db().pool), {
    provider: "cloudflare",
    model,
    threshold: "0.7",
    ...overrides,
  });

const thresholdsHeld = async (model: string) => {
  const stored = await db().pool.query(
    "SELECT provider, threshold FROM decision_threshold WHERE model = $1",
    [model],
  );
  const recorded = await db().pool.query(
    `SELECT actor, subject_id, detail FROM identity_audit_event
      WHERE action = 'platform.model.threshold_set' AND detail->>'model' = $1 ORDER BY at, id`,
    [model],
  );
  return { stored: stored.rows, recorded: recorded.rows };
};

describe("a decision model's threshold", () => {
  it("stores a threshold and records who set it", async () => {
    const model = aModel();

    expect(await thresholding(model, {})).toEqual({
      ok: true,
      value: { provider: "cloudflare", model, threshold: 0.7 },
    });
    expect(await thresholdsHeld(model)).toEqual({
      stored: [{ provider: "cloudflare", threshold: 0.7 }],
      recorded: [
        {
          actor: PLATFORM.actorId,
          subject_id: `cloudflare/${model}`,
          detail: { provider: "cloudflare", model, threshold: 0.7 },
        },
      ],
    });
  });

  it("replaces a threshold set before, recording each", async () => {
    const model = aModel();

    await thresholding(model, {});
    const second = await thresholding(model, { threshold: "0.65" });

    expect(second).toEqual({
      ok: true,
      value: { provider: "cloudflare", model, threshold: 0.65 },
    });
    expect(await thresholdsHeld(model)).toEqual({
      stored: [{ provider: "cloudflare", threshold: 0.65 }],
      recorded: [0.7, 0.65].map((threshold) => ({
        actor: PLATFORM.actorId,
        subject_id: `cloudflare/${model}`,
        detail: { provider: "cloudflare", model, threshold },
      })),
    });
  });

  it.each([
    ["nought", { threshold: "0" }],
    ["one", { threshold: "1" }],
    ["one and a half", { threshold: "1.5" }],
    ["a word", { threshold: "abc" }],
    ["a bare fraction", { threshold: ".5" }],
    ["a provider outside the three", { provider: "openai" }],
  ])("refuses %s as malformed, writing nothing", async (_shape, overrides) => {
    const model = aModel();

    expect(await thresholding(model, overrides)).toEqual({ ok: false, error: "malformed" });
    expect(await thresholdsHeld(model)).toEqual({ stored: [], recorded: [] });
  });

  it("refuses a model name with capitals as malformed", async () => {
    expect(await thresholding(aModel(), { model: "Clef Flash" })).toEqual({
      ok: false,
      error: "malformed",
    });
  });

  it("refuses a messages provider as not a decision model", async () => {
    const model = aModel();

    expect(await thresholding(model, { provider: "anthropic" })).toEqual({
      ok: false,
      error: "not-a-decision-model",
    });
    expect(await thresholdsHeld(model)).toEqual({ stored: [], recorded: [] });
  });

  it("answers the store's failure and sets nothing", async () => {
    const model = aModel();

    const refused = await whileWritesAreRefused(db().pool, "decision_threshold", () =>
      thresholding(model, {}),
    );

    expect(refused.ok ? "set" : refused.error).toBeInstanceOf(Error);
    expect(await thresholdsHeld(model)).toEqual({ stored: [], recorded: [] });
  });
});
