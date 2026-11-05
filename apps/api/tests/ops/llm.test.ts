import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { err, ok } from "@better-answers/core/kernel";
import { openCredentials, openModelKeySetting } from "@better-answers/core/llm";
import { openPostgres, withScope } from "@better-answers/core/store/postgres";
import { objectStoreForSuite } from "@better-answers/core/testing/objects";
import { whileWritesAreRefused } from "@better-answers/core/testing/postgres";
import { BOOTSTRAP } from "@better-answers/core/workspaces";
import { ulid } from "@better-answers/schema";
import { matching } from "@better-answers/schema/testing/matching";

import type { OpsIo } from "../../src/ops/index.ts";
import type { TestApp } from "../support/harness/harness.ts";
import {
  opsRunner,
  type Run,
  BOOTSTRAP_ACTOR,
  rowsOfAction,
  auditLogOf,
} from "../support/ops-run.ts";
import { workspaceRoot } from "../support/roots/roots.ts";
import { servedApp } from "../support/suite-app.ts";

const objects = objectStoreForSuite();
const { ops, help, opsWith } = opsRunner(objects);

describe("pnpm ops", () => {
  const served = servedApp();

  describe("set-model-key, which stores a workspace's model key", () => {
    const ENVELOPE_KEY = Uint8Array.from({ length: 32 }, (_byte, index) => index);
    const KEK = Buffer.from(ENVELOPE_KEY).toString("hex");
    const credentials = openCredentials(ENVELOPE_KEY);
    const modelKeySetting = openModelKeySetting(ENVELOPE_KEY);
    const A_KEY = "sk-test-u9-invented-ops-0001";
    const A_NEWER_KEY = "sk-test-u9-invented-ops-0002";

    const ACTION = "platform.workspace.model_key_set";
    const ANTHROPIC = ["--provider", "anthropic"];

    const setting = (
      app: TestApp,
      workspaceId: string,
      typed: string,
      flags: readonly string[] = ANTHROPIC,
      io: Pick<OpsIo, "modelKeySetting"> = { modelKeySetting: ok(modelKeySetting) },
    ): Promise<Run> =>
      opsWith(app, ["set-model-key", "--workspace", workspaceId, ...flags], {
        io: { stdin: async () => typed, ...io },
      });

    const keyHeld = async (
      app: TestApp,
      workspaceId: string,
      provider: "anthropic" | "mistral",
    ) => {
      const read = await withScope(BOOTSTRAP, openPostgres(app.database.pool), workspaceId, (tx) =>
        credentials.readModelKey(tx, provider),
      );
      return read.ok ? read.value?.reveal() : read.error;
    };

    const rowsHeld = async (app: TestApp, workspaceId: string) => {
      const held = await app.database.superuser.query<{ provider: string; sealed: Buffer }>(
        "SELECT provider, sealed FROM model_key WHERE workspace_id = $1 ORDER BY provider",
        [workspaceId],
      );
      return held.rows;
    };

    const setEvent = (workspaceId: string, provider: string) => ({
      actor: BOOTSTRAP_ACTOR,
      subject_id: workspaceId,
      detail: { provider },
    });

    const MALFORMED =
      "set-model-key: REFUSED — malformed: --workspace must be a workspace id and --provider one of anthropic, mistral, cloudflare. Standard input must hold one key with no spaces or line breaks. For cloudflare, the key is the account id, a colon, then the API token.";

    it("encrypts the key from standard input and audits the provider", async () => {
      const { workspaceId } = await served().provision();

      const run = await setting(served(), workspaceId, `${A_KEY}\n`);

      expect({ exitCode: run.exitCode, lines: run.lines }).toEqual({
        exitCode: 0,
        lines: [`set-model-key: done — workspace ${workspaceId} has a new key for anthropic`],
      });
      expect(await keyHeld(served(), workspaceId, "anthropic")).toBe(A_KEY);
      expect(await rowsOfAction(served(), workspaceId, ACTION)).toEqual([
        setEvent(workspaceId, "anthropic"),
      ]);
    });

    it("replaces the key on a second run, keeping one row", async () => {
      const { workspaceId } = await served().provision();

      await setting(served(), workspaceId, A_KEY, ["--provider", "mistral"]);
      const again = await setting(served(), workspaceId, `${A_NEWER_KEY}\r\n`, [
        "--provider",
        "mistral",
      ]);

      expect(again.exitCode).toBe(0);
      expect(await rowsHeld(served(), workspaceId)).toHaveLength(1);
      expect(await keyHeld(served(), workspaceId, "mistral")).toBe(A_NEWER_KEY);
      expect(await rowsOfAction(served(), workspaceId, ACTION)).toEqual([
        setEvent(workspaceId, "mistral"),
        setEvent(workspaceId, "mistral"),
      ]);
    });

    it("never prints, logs, or stores the key in plain text", async () => {
      const { workspaceId } = await served().provision();

      const set = await setting(served(), workspaceId, A_KEY);
      const refusedByTheStore = await whileWritesAreRefused(
        served().database.superuser,
        "model_key",
        () => setting(served(), workspaceId, A_NEWER_KEY),
      );
      const malformed = await setting(served(), workspaceId, `${A_NEWER_KEY} ${A_NEWER_KEY}`);
      const unsealed = await setting(served(), workspaceId, A_NEWER_KEY, ANTHROPIC, {
        modelKeySetting: err("KEK must be set to the envelope key"),
      });

      expect(
        await keyHeld(served(), workspaceId, "anthropic"),
        "a refused run changed the stored key",
      ).toBe(A_KEY);
      expect([set, refusedByTheStore, malformed, unsealed].map((run) => run.exitCode)).toEqual([
        0, 1, 2, 1,
      ]);
      const everythingSaid = [
        JSON.stringify([set, refusedByTheStore, malformed, unsealed]),
        JSON.stringify(await rowsOfAction(served(), workspaceId, ACTION)),
        ...(await rowsHeld(served(), workspaceId)).map((row) => row.sealed.toString("latin1")),
      ].join("\n");
      const secrets = [A_KEY, A_NEWER_KEY, KEK, Buffer.from(ENVELOPE_KEY).toString("base64")];
      expect(secrets.filter((secret) => everythingSaid.includes(secret))).toEqual([]);
    });

    it("refuses without the KEK envelope key and stores nothing", async () => {
      const { workspaceId } = await served().provision();

      const refused = await setting(served(), workspaceId, A_KEY, ANTHROPIC, {
        modelKeySetting: err("KEK must be set to the envelope key"),
      });

      expect({ exitCode: refused.exitCode, lines: refused.lines }).toEqual({
        exitCode: 1,
        lines: ["set-model-key: REFUSED — KEK must be set to the envelope key. Nothing changed."],
      });
      expect(await rowsHeld(served(), workspaceId)).toEqual([]);
    });

    it("refuses a Cloudflare token without its account id, unprinted", async () => {
      const { workspaceId } = await served().provision();
      const tokenAlone = "invented_Token-u15";

      const refused = await setting(served(), workspaceId, tokenAlone, [
        "--provider",
        "cloudflare",
      ]);
      const accepted = await setting(
        served(),
        workspaceId,
        `0123456789abcdef0123456789abcdef:${tokenAlone}`,
        ["--provider", "cloudflare"],
      );

      expect({ exitCode: refused.exitCode, lines: refused.lines }).toEqual({
        exitCode: 2,
        lines: [MALFORMED],
      });
      expect(JSON.stringify(refused)).not.toContain(tokenAlone);
      expect(accepted.exitCode).toBe(0);
      expect(await rowsOfAction(served(), workspaceId, ACTION)).toEqual([
        setEvent(workspaceId, "cloudflare"),
      ]);
    });

    const throughTheEntrypoint = (workspaceId: string, typed: string, kek: string | undefined) => {
      const inherited = Object.entries(process.env).filter(([name]) => name !== "KEK");
      const finished = spawnSync(
        process.execPath,
        ["src/ops.ts", "set-model-key", "--workspace", workspaceId, "--provider", "anthropic"],
        {
          cwd: workspaceRoot,
          encoding: "utf8",
          input: typed,
          env: {
            ...Object.fromEntries(inherited),
            DATABASE_URL: served().database.connectionUri,
            ...(kek === undefined ? {} : { KEK: kek }),
          },
        },
      );
      return { status: finished.status, printed: `${finished.stdout}${finished.stderr}` };
    };

    it(
      "stores the key through src/ops.ts and prints neither key",
      { timeout: 60_000 },
      async () => {
        const { workspaceId } = await served().provision();

        const run = throughTheEntrypoint(workspaceId, A_KEY, KEK);

        expect(run).toEqual({
          status: 0,
          printed: matching.stringContaining(
            `set-model-key: done — workspace ${workspaceId} has a new key for anthropic`,
          ),
        });
        expect(await keyHeld(served(), workspaceId, "anthropic")).toBe(A_KEY);
        expect([A_KEY, KEK].filter((secret) => run.printed.includes(secret))).toEqual([]);
      },
    );

    it.each([
      ["no `KEK`", undefined],
      ["a malformed `KEK`", "not-an-envelope-key-u9"],
    ])("refuses through src/ops.ts with %s", { timeout: 60_000 }, async (_shape, kek) => {
      const { workspaceId } = await served().provision();

      const run = throughTheEntrypoint(workspaceId, A_KEY, kek);

      expect(run).toEqual({
        status: 1,
        printed: matching.stringContaining(
          "set-model-key: REFUSED — KEK must be set to the envelope key: 64 hexadecimal characters, encoding 32 bytes. Nothing changed.",
        ),
      });
      expect(
        [A_KEY, "not-an-envelope-key-u9"].filter((said) => run.printed.includes(said)),
      ).toEqual([]);
      expect(await rowsHeld(served(), workspaceId)).toEqual([]);
    });

    it.each([
      ["an empty standard input", "", ["--provider", "anthropic"]],
      ["a key holding a space", "sk-test u9", ["--provider", "anthropic"]],
      ["a key over two lines", "sk-test\nu9", ["--provider", "anthropic"]],
      ["an unknown model provider", A_KEY, ["--provider", "openai"]],
    ])("refuses %s as malformed, changing nothing", async (_shape, typed, flags) => {
      const { workspaceId } = await served().provision();

      const run = await setting(served(), workspaceId, typed, flags);

      expect({ exitCode: run.exitCode, lines: run.lines }).toEqual({
        exitCode: 2,
        lines: [MALFORMED],
      });
      expect(await rowsHeld(served(), workspaceId)).toEqual([]);
      expect(await rowsOfAction(served(), workspaceId, ACTION)).toEqual([]);
    });

    it("refuses an unknown workspace id as no-such-workspace", async () => {
      const nowhere = ulid();

      const run = await setting(served(), nowhere, A_KEY);

      expect(run.exitCode).toBe(6);
      expect(run.lines).toEqual([
        `set-model-key: REFUSED — no-such-workspace: no workspace has the id ${nowhere}`,
      ]);
      expect(await auditLogOf(served(), nowhere)).toEqual([]);
    });

    it("gives a usage error without --provider and stores nothing", async () => {
      const { workspaceId } = await served().provision();

      const run = await setting(served(), workspaceId, A_KEY, []);

      expect(run.exitCode).toBe(2);
      expect(run.lines).toEqual([
        "set-model-key: --workspace <id> and --provider <anthropic|mistral|cloudflare> are required, with the key on standard input",
      ]);
      expect(await rowsHeld(served(), workspaceId)).toEqual([]);
    });

    it("lists the command in the help text", async () => {
      const run = await ops(served(), ["help"]);

      expect(run.lines.join("\n")).toContain(
        "set-model-key --workspace <id> --provider <anthropic|mistral|cloudflare>",
      );
    });
  });

  describe("set-spending-limit, which caps a workspace's monthly model spend", () => {
    const limitHeld = async (app: TestApp, workspaceId: string) => {
      const held = await app.database.superuser.query<{ value: string }>(
        "SELECT value FROM workspace_config WHERE workspace_id = $1 AND key = 'llm.spending_limit_gbp'",
        [workspaceId],
      );
      return held.rows.map((row) => row.value);
    };

    const limiting = (app: TestApp, workspaceId: string, gbp: string): Promise<Run> =>
      ops(app, ["set-spending-limit", "--workspace", workspaceId, "--gbp", gbp]);

    it("sets the limit, and a second run replaces it", async () => {
      const { workspaceId } = await served().provision();

      const first = await limiting(served(), workspaceId, "50");
      const again = await limiting(served(), workspaceId, "12.50");

      expect({ exitCode: first.exitCode, lines: first.lines }).toEqual({
        exitCode: 0,
        lines: [
          `set-spending-limit: done — workspace ${workspaceId} may spend £50 on model calls each calendar month`,
        ],
      });
      expect(again.exitCode).toBe(0);
      expect(await limitHeld(served(), workspaceId)).toEqual(["12.50"]);
      const set = { actor: BOOTSTRAP_ACTOR, subject_id: workspaceId, detail: {} };
      expect(
        await rowsOfAction(served(), workspaceId, "platform.workspace.spending_limit_set"),
      ).toEqual([set, set]);
    });

    it("refuses a sum that is not in pounds as malformed", async () => {
      const { workspaceId } = await served().provision();

      const run = await limiting(served(), workspaceId, "fifty");

      expect({ exitCode: run.exitCode, lines: run.lines }).toEqual({
        exitCode: 2,
        lines: [
          "set-spending-limit: REFUSED — malformed: --workspace must be a workspace id and --gbp a sum in pounds, such as 50 or 12.50",
        ],
      });
      expect(await limitHeld(served(), workspaceId)).toEqual([]);
    });

    it("refuses an unknown workspace id as no-such-workspace", async () => {
      const nowhere = ulid();

      const run = await limiting(served(), nowhere, "50");

      expect({ exitCode: run.exitCode, lines: run.lines }).toEqual({
        exitCode: 6,
        lines: [
          `set-spending-limit: REFUSED — no-such-workspace: no workspace has the id ${nowhere}`,
        ],
      });
    });
  });

  describe("set-model-price, which prices a model from a given day", () => {
    const SONNET = "claude-sonnet-5-5";

    const pricing = (app: TestApp, from: string, gbpIn = "3", gbpOut = "15"): Promise<Run> =>
      ops(app, [
        "set-model-price",
        "--provider",
        "anthropic",
        "--model",
        SONNET,
        "--from",
        from,
        "--gbp-per-million-in",
        gbpIn,
        "--gbp-per-million-out",
        gbpOut,
      ]);

    const pricesHeld = async (app: TestApp) => {
      const held = await app.database.superuser.query<Record<string, unknown>>(
        `SELECT effective_from::text AS "from", gbp_per_million_in, gbp_per_million_out
           FROM model_price WHERE provider = 'anthropic' AND model = $1 ORDER BY effective_from`,
        [SONNET],
      );
      return held.rows;
    };

    it("sets the price, and a same-day run replaces it", async () => {
      const first = await pricing(served(), "2026-10-14");
      const again = await pricing(served(), "2026-10-14", "2.5", "12");

      expect({ exitCode: first.exitCode, lines: first.lines }).toEqual({
        exitCode: 0,
        lines: [`set-model-price: done — anthropic ${SONNET} has a price from 2026-10-14`],
      });
      expect(again.exitCode).toBe(0);
      expect(await pricesHeld(served())).toEqual([
        { from: "2026-10-14", gbp_per_million_in: "2.5", gbp_per_million_out: "12" },
      ]);
    });

    it("refuses a date that does not exist as malformed", async () => {
      const before = await pricesHeld(served());

      const run = await pricing(served(), "2026-02-30");

      expect(run.exitCode).toBe(2);
      expect(run.lines).toEqual([
        matching.stringMatching(/^set-model-price: REFUSED — malformed: /),
      ]);
      expect(await pricesHeld(served())).toEqual(before);
    });

    it("gives a usage error for missing flags and writes nothing", async () => {
      const before = await pricesHeld(served());

      const run = await ops(served(), [
        "set-model-price",
        "--provider",
        "anthropic",
        "--model",
        SONNET,
      ]);

      expect(run.exitCode).toBe(2);
      expect(await pricesHeld(served())).toEqual(before);
    });

    it("lists both spending commands in the help text", async () => {
      const run = await ops(served(), ["help"]);

      expect(run.lines.join("\n")).toContain("set-spending-limit --workspace <id> --gbp <pounds>");
      expect(run.lines.join("\n")).toContain(
        "set-model-price --provider <anthropic|mistral|cloudflare> --model <model> --from <yyyy-mm-dd>",
      );
    });
  });

  describe("set-decision-threshold, which sets a decision model's threshold", () => {
    const thresholding = (
      app: TestApp,
      provider: string,
      model: string,
      threshold: string,
    ): Promise<Run> =>
      ops(app, [
        "set-decision-threshold",
        "--provider",
        provider,
        "--model",
        model,
        "--threshold",
        threshold,
      ]);

    const thresholdsHeld = async (app: TestApp, model: string) => {
      const held = await app.database.superuser.query<Record<string, unknown>>(
        "SELECT provider, threshold FROM decision_threshold WHERE model = $1",
        [model],
      );
      return held.rows;
    };

    const aModel = (): string => `clef-${ulid().toLowerCase()}`;

    it("sets the threshold, and a second run replaces it", async () => {
      const model = aModel();

      const first = await thresholding(served(), "cloudflare", model, "0.7");
      const again = await thresholding(served(), "cloudflare", model, "0.65");

      expect([first, again].map(({ exitCode, lines }) => ({ exitCode, lines }))).toEqual([
        {
          exitCode: 0,
          lines: [`set-decision-threshold: done — cloudflare ${model} now has a threshold of 0.7`],
        },
        {
          exitCode: 0,
          lines: [`set-decision-threshold: done — cloudflare ${model} now has a threshold of 0.65`],
        },
      ]);
      expect(await thresholdsHeld(served(), model)).toEqual([
        { provider: "cloudflare", threshold: 0.65 },
      ]);
    });

    it("refuses a threshold outside the open range 0 to 1", async () => {
      const model = aModel();

      const run = await thresholding(served(), "cloudflare", model, "1");

      expect({ exitCode: run.exitCode, lines: run.lines }).toEqual({
        exitCode: 2,
        lines: [
          "set-decision-threshold: REFUSED — malformed: give --provider <cloudflare>, --model <model> and --threshold <probability>. The model may hold only lower case letters, digits, dots and hyphens, and the threshold must be a decimal between 0 and 1, such as 0.7.",
        ],
      });
      expect(await thresholdsHeld(served(), model)).toEqual([]);
    });

    it("refuses anthropic as not-a-decision-model", async () => {
      const model = aModel();

      const run = await thresholding(served(), "anthropic", model, "0.7");

      expect({ exitCode: run.exitCode, lines: run.lines }).toEqual({
        exitCode: 7,
        lines: [
          "set-decision-threshold: REFUSED — not-a-decision-model: anthropic models do not return a yes-or-no decision, so they take no threshold. Only cloudflare models do. Nothing changed.",
        ],
      });
      expect(await thresholdsHeld(served(), model)).toEqual([]);
    });

    it("gives a usage error without --threshold and writes nothing", async () => {
      const model = aModel();

      const run = await ops(served(), [
        "set-decision-threshold",
        "--provider",
        "cloudflare",
        "--model",
        model,
      ]);

      expect({ exitCode: run.exitCode, lines: run.lines }).toEqual({
        exitCode: 2,
        lines: [
          "set-decision-threshold: --provider <cloudflare>, --model <model> and --threshold <probability> are required",
        ],
      });
      expect(await thresholdsHeld(served(), model)).toEqual([]);
    });

    it("lists the command in the help text", async () => {
      expect(await help(served())).toContain(
        "set-decision-threshold --provider <cloudflare> --model <model> --threshold <probability>",
      );
    });
  });

  describe("set-model-choice, which sets a workspace's model for a purpose", () => {
    const HAIKU = "claude-haiku-5-5";

    const choosing = (
      app: TestApp,
      workspaceId: string,
      provider: string,
      purpose = "judging",
    ): Promise<Run> =>
      ops(app, [
        "set-model-choice",
        "--workspace",
        workspaceId,
        "--purpose",
        purpose,
        "--provider",
        provider,
        "--model",
        HAIKU,
      ]);

    const choicesHeld = async (app: TestApp, workspaceId: string) => {
      const held = await app.database.superuser.query<Record<string, unknown>>(
        "SELECT purpose, provider, model FROM model_choice WHERE workspace_id = $1",
        [workspaceId],
      );
      return held.rows;
    };

    const priced = (app: TestApp): Promise<Run> =>
      ops(app, [
        "set-model-price",
        "--provider",
        "anthropic",
        "--model",
        HAIKU,
        "--from",
        "2026-01-01",
        "--gbp-per-million-in",
        "0.08",
        "--gbp-per-million-out",
        "0.4",
      ]);

    it("stores a priced model from a sub-processor the DPIA names", async () => {
      const { workspaceId } = await served().provision();
      expect((await priced(served())).exitCode).toBe(0);

      const run = await choosing(served(), workspaceId, "anthropic");

      expect({ exitCode: run.exitCode, lines: run.lines }).toEqual({
        exitCode: 0,
        lines: [
          `set-model-choice: done — workspace ${workspaceId} calls anthropic ${HAIKU} for judging`,
        ],
      });
      expect(await choicesHeld(served(), workspaceId)).toEqual([
        { purpose: "judging", provider: "anthropic", model: HAIKU },
      ]);
      expect(
        await rowsOfAction(served(), workspaceId, "platform.workspace.model_choice_set"),
      ).toEqual([
        {
          actor: BOOTSTRAP_ACTOR,
          subject_id: workspaceId,
          detail: { purpose: "judging", provider: "anthropic", model: HAIKU },
        },
      ]);
    });

    it("refuses a provider the DPIA does not name as no-sub-processor", async () => {
      const { workspaceId } = await served().provision();

      const run = await choosing(served(), workspaceId, "openai");

      expect({ exitCode: run.exitCode, lines: run.lines }).toEqual({
        exitCode: 9,
        lines: [
          "set-model-choice: REFUSED — no-sub-processor: the DPIA does not name openai as a sub-processor. Choose one of anthropic, mistral. Nothing changed.",
        ],
      });
      expect(await choicesHeld(served(), workspaceId)).toEqual([]);
    });

    it("refuses the local provider as no-sub-processor", async () => {
      const { workspaceId } = await served().provision();

      const run = await choosing(served(), workspaceId, "local");

      expect({ exitCode: run.exitCode, lines: run.lines }).toEqual({
        exitCode: 9,
        lines: [
          "set-model-choice: REFUSED — no-sub-processor: the DPIA does not name local as a sub-processor. Choose one of anthropic, mistral. Nothing changed.",
        ],
      });
      expect(await choicesHeld(served(), workspaceId)).toEqual([]);
    });

    it("refuses cloudflare without a threshold and names set-decision-threshold", async () => {
      const { workspaceId } = await served().provision();

      const run = await choosing(served(), workspaceId, "cloudflare");

      expect({ exitCode: run.exitCode, lines: run.lines }).toEqual({
        exitCode: 9,
        lines: [
          `set-model-choice: REFUSED — no-decision-threshold: cloudflare ${HAIKU} is a decision model with no threshold. Set one with set-decision-threshold first. Nothing changed.`,
        ],
      });
      expect(await choicesHeld(served(), workspaceId)).toEqual([]);
    });

    it("refuses a model with no price in effect as no-model-price", async () => {
      const { workspaceId } = await served().provision();

      const run = await choosing(served(), workspaceId, "mistral");

      expect({ exitCode: run.exitCode, lines: run.lines }).toEqual({
        exitCode: 9,
        lines: [
          `set-model-choice: REFUSED — no-model-price: mistral ${HAIKU} has no price in effect today. Set one with set-model-price first. Nothing changed.`,
        ],
      });
    });

    it("refuses a choice for the embedding purpose", async () => {
      const { workspaceId } = await served().provision();

      const run = await choosing(served(), workspaceId, "anthropic", "embedding");

      expect({ exitCode: run.exitCode, lines: run.lines }).toEqual({
        exitCode: 7,
        lines: [
          "set-model-choice: REFUSED — fixed-model-choice: the embedding model cannot be changed, because the index's vectors were made with it. Nothing changed.",
        ],
      });
    });

    it("refuses an unknown purpose and an unknown workspace id", async () => {
      const nowhere = ulid();
      const { workspaceId } = await served().provision();
      expect((await priced(served())).exitCode).toBe(0);

      const malformed = await choosing(served(), workspaceId, "anthropic", "guessing");
      const absent = await choosing(served(), nowhere, "anthropic");

      expect([malformed.exitCode, absent.exitCode]).toEqual([2, 6]);
      expect(malformed.lines).toEqual([
        "set-model-choice: REFUSED — malformed: --workspace must be a workspace id, --purpose one of extraction, enrichment, answering, judging, and --provider and --model only lower case letters, digits, dots and hyphens",
      ]);
      expect(absent.lines).toEqual([
        `set-model-choice: REFUSED — no-such-workspace: no workspace has the id ${nowhere}`,
      ]);
    });

    it("gives a usage error without --purpose, --provider, or --model", async () => {
      const { workspaceId } = await served().provision();

      const run = await ops(served(), ["set-model-choice", "--workspace", workspaceId]);

      expect({ exitCode: run.exitCode, lines: run.lines }).toEqual({
        exitCode: 2,
        lines: [
          "set-model-choice: --workspace <id>, --purpose <extraction|enrichment|answering|judging>, --provider <provider> and --model <model> are required",
        ],
      });
      expect(await choicesHeld(served(), workspaceId)).toEqual([]);
    });

    it("lists the command in the help text", async () => {
      expect(await help(served())).toContain(
        "set-model-choice --workspace <id> --purpose <extraction|enrichment|answering|judging> --provider <anthropic|mistral> --model <model>",
      );
    });
  });
});
