import { getTableName, type Table } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { initRepository } from "@better-answers/core/store/git";
import { objectStoreForSuite } from "@better-answers/core/testing/objects";
import {
  bundleCommit,
  conceptIndex,
  conceptVerification,
  connectedSource,
  decisionThreshold,
  erasureRequest,
  mapEdge,
  mapGeneration,
  mapNode,
  mapUnresolvedReference,
  job,
  llmCall,
  modelChoice,
  modelKey,
  modelPrice,
  questionAsked,
  questionFeedback,
  sourceDocument,
  spendReservation,
  suppression,
  ulid,
} from "@better-answers/schema";
import { testData } from "@better-answers/schema/testing";
import { matching } from "@better-answers/schema/testing/matching";

import { EXIT_OF_CLASS, NOT_BUILT, parseSince, SLICE_COMMANDS } from "../../src/ops/index.ts";
import { openTestGit } from "../support/harness/harness.ts";
import { opsRunner } from "../support/ops-run.ts";
import { servedApp } from "../support/suite-app.ts";

const objects = objectStoreForSuite();
const { ops, opsBeforeTheJournal } = opsRunner(objects);

const SLICE_TABLES: Readonly<Record<string, readonly Table[]>> = {
  "map-rebuild": [mapGeneration, mapNode, mapEdge, mapUnresolvedReference, job],
  "map-sweep": [mapGeneration, mapNode, mapEdge, mapUnresolvedReference],
  "map-counts": [mapGeneration, mapNode, mapEdge],
  "unmapped-passage-rate": [questionAsked, questionFeedback],
  "reconcile-watermark": [conceptIndex, bundleCommit],
  "object-store-orphans": [sourceDocument],
  "reindex-connected-sources": [connectedSource, job],
  "erasure-rehearsal": [erasureRequest, suppression],
  "import-bundle": [conceptIndex, bundleCommit, conceptVerification],
  "set-spending-limit": [llmCall, spendReservation],
  "set-model-key": [modelKey],
  "set-model-choice": [modelChoice, modelPrice, decisionThreshold],
  "update-concept-body": [conceptIndex, bundleCommit],
};

const WELL_FORMED_FLAGS: Readonly<Record<string, readonly string[]>> = {
  "object-store-orphans": ["--list"],
  "erasure-rehearsal": ["--synthetic", "--seed"],
  "import-bundle": ["--from", "/dump", "--as", "admin@acme.invalid"],
  "update-concept-body": [
    "--iri",
    "https://acme.invalid/c/x",
    "--as",
    "admin@acme.invalid",
    "--dry-run",
  ],
  "set-model-key": ["--provider", "anthropic"],
  "set-spending-limit": ["--gbp", "1"],
  "set-model-choice": ["--purpose", "judge", "--provider", "anthropic", "--model", "m"],
};

const wellFormed = (command: string): readonly string[] => [
  command,
  "--workspace",
  "ws_synthetic",
  ...(WELL_FORMED_FLAGS[command] ?? []),
];

describe("pnpm ops — the restore scripts' commands", () => {
  const served = servedApp();

  it("reads a dump stamp and an ISO instant alike", () => {
    expect(parseSince("20260903T020500Z")?.toISOString()).toBe("2026-09-03T02:05:00.000Z");
    expect(parseSince("2026-09-03T02:05:00Z")?.toISOString()).toBe("2026-09-03T02:05:00.000Z");
    expect(parseSince("yesterday")).toBeUndefined();
  });

  it("answers usage to a missing or unknown command, never guessing", async () => {
    expect((await ops(served(), [])).exitCode).toBe(2);
    expect((await ops(served(), ["make-it-so"])).exitCode).toBe(2);
    expect((await ops(served(), ["map-counts"])).exitCode).toBe(2);
    expect((await ops(served(), ["replay-erasures"])).exitCode).toBe(2);
  });

  it.each(["toString", "__proto__"])(
    "answers %s, a name every object inherits, as unknown",
    async (command) => {
      const run = await ops(served(), [command, "--workspace", ulid()]);

      expect(run.exitCode).toBe(2);
      expect(run.lines.join("\n")).toContain(`unknown command: ${command}`);
    },
  );

  it("prints a refusal's word and exits with its class's code", async () => {
    const run = await ops(served(), ["map-counts", "--workspace", "not-a-workspace-id"]);

    expect(run.exitCode).toBe(2);
    expect(run.lines.join("\n")).toContain("REFUSED — malformed");
  });

  it("says which runs exit 1 whatever word they name", async () => {
    const run = await ops(served(), ["help"]);

    expect(run.lines.join("\n")).toContain(
      "a run that names the file or commit it stopped at exits 1, whatever word it names: import-bundle's unsound tree and stopped import, reconcile-watermark's stopped replay",
    );
    expect(run.lines.join("\n")).toContain(
      "an import whose manifest commit is refused as malformed exits 1 too: only a defect in the import can cause it",
    );
  });

  it("gives each class its own code, telling refusals apart", () => {
    const codes = Object.values(EXIT_OF_CLASS);

    expect(EXIT_OF_CLASS).toEqual({
      malformed: 2,
      unauthenticated: 4,
      forbidden: 5,
      absent: 6,
      inapplicable: 7,
      conflict: 8,
      precondition: 9,
    });
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).not.toContain(0);
  });

  it("skips pnpm's -- separator, which is not a command", async () => {
    const run = await opsBeforeTheJournal(served(), [
      "--",
      "replay-erasures",
      "--since",
      "20260904T000000Z",
    ]);

    expect(run.exitCode).toBe(0);
    expect(run.lines.join("\n")).toContain("replayed 0 erasures");
    expect((await ops(served(), ["--"])).exitCode).toBe(2);
  });

  describe("the slice-owned commands", () => {
    it.each(["erasure-rehearsal", "object-store-orphans", "import-bundle"])(
      "%s says `not built`, exit 3, without its slice's tables",
      async (command) => {
        const run = await opsBeforeTheJournal(served(), wellFormed(command));

        expect(run.exitCode).toBe(NOT_BUILT);
        expect(run.lines.join("\n")).toContain("not built");
      },
    );

    it("names absent exactly the tables the schema's objects name", async () => {
      expect([...SLICE_COMMANDS].toSorted()).toEqual(Object.keys(SLICE_TABLES).toSorted());

      for (const [command, tables] of Object.entries(SLICE_TABLES)) {
        const run = await opsBeforeTheJournal(served(), wellFormed(command));
        const absent = tables.map((table) => getTableName(table)).join(", ");

        expect({ command, exitCode: run.exitCode, said: run.lines }).toEqual({
          command,
          exitCode: NOT_BUILT,
          said: [
            `${command}: not built — ${absent} absent from this schema; the slice that owns them has not landed`,
          ],
        });
      }
    });

    it("answers in its own name, never another command's", async () => {
      const { workspaceId } = await served().provision();

      for (const command of SLICE_COMMANDS) {
        const run = await ops(served(), [command, "--workspace", workspaceId]);
        const said = run.lines.join("\n");
        const others = SLICE_COMMANDS.filter((other) => other !== command).filter((other) =>
          said.includes(`${other}:`),
        );
        expect({ command, others }).toEqual({ command, others: [] });
      }
    });

    describe("on the synthetic fixture's workspace, as the drill leaves it", () => {
      const synthetic = "01M2SYNTHET1CAAAAAAAAAAAAA";

      beforeAll(async () => {
        const client = await served().database.superuser.connect();
        try {
          await testData(client).workspace({ id: synthetic });
        } finally {
          client.release();
        }
        await initRepository(openTestGit(served()), synthetic);
      });

      it.each([
        {
          command: "reconcile-watermark",
          flags: [],
          exitCode: 0,
          first:
            "reconcile-watermark: done — head none, watermark none, replayed 0, already landed 0",
        },
        {
          command: "map-rebuild",
          flags: [],
          exitCode: 0,
          first: matching.stringMatching(/^map-rebuild: done — enqueued [0-9A-HJKMNP-TV-Z]{26}$/),
        },
        {
          command: "map-sweep",
          flags: [],
          exitCode: 0,
          first: "map-sweep: done — nothing to sweep",
        },
        {
          command: "object-store-orphans",
          flags: ["--list"],
          exitCode: 0,
          first:
            "object-store-orphans: done — 0 objects past the 24-hour grace no document names, removed none",
        },
        {
          command: "map-counts",
          flags: [],
          exitCode: 0,
          first: '{"live_gen":null,"nodes":{},"edges":{}}',
        },
        {
          command: "erasure-rehearsal",
          flags: ["--synthetic", "--run", "--report", "/dev/null"],
          exitCode: EXIT_OF_CLASS.precondition,
          first:
            "erasure-rehearsal: REFUSED — no synthetic subject stands in this workspace — phase one (--seed) has not been run here, or its subject has already been erased",
        },
      ])(
        "$command, run as the drill does, takes the synthetic id",
        async ({ command, flags, exitCode, first }) => {
          const run = await ops(served(), [command, "--workspace", synthetic, ...flags]);

          expect({ exitCode: run.exitCode, first: run.lines[0] }).toEqual({ exitCode, first });
        },
      );
    });
  });
});
