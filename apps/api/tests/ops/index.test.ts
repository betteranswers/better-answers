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

describe("pnpm ops", () => {
  const served = servedApp();

  it("parseSince reads a dump timestamp and an ISO instant", () => {
    expect(parseSince("20260903T020500Z")?.toISOString()).toBe("2026-09-03T02:05:00.000Z");
    expect(parseSince("2026-09-03T02:05:00Z")?.toISOString()).toBe("2026-09-03T02:05:00.000Z");
    expect(parseSince("yesterday")).toBeUndefined();
  });

  it("prints the refusal word and exits with its class's code", async () => {
    const run = await ops(served(), ["map-counts", "--workspace", "not-a-workspace-id"]);

    expect(run.exitCode).toBe(2);
    expect(run.lines.join("\n")).toContain("REFUSED — malformed");
  });

  it("help lists the runs that always exit 1", async () => {
    const run = await ops(served(), ["help"]);

    expect(run.lines.join("\n")).toContain(
      "A run that stops at a named file or commit exits 1, whatever refusal word it prints. These runs are import-bundle with an unsound tree or a stopped import, and reconcile-watermark with a stopped replay.",
    );
    expect(run.lines.join("\n")).toContain(
      "An import whose manifest commit is refused as malformed also exits 1, because only a defect in the import can cause that refusal.",
    );
  });

  it("gives each refusal class a distinct nonzero exit code", () => {
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

  it("skips the -- separator that pnpm passes before the command", async () => {
    const run = await opsBeforeTheJournal(served(), [
      "--",
      "replay-erasures",
      "--since",
      "20260904T000000Z",
    ]);

    expect(run.exitCode).toBe(0);
    expect(run.lines.join("\n")).toContain("replayed 0 erasures");
  });

  describe("commands whose tables a slice owns", () => {
    it.each(["erasure-rehearsal", "object-store-orphans", "import-bundle"])(
      "%s exits 3 with `not built` without its tables",
      async (command) => {
        const run = await opsBeforeTheJournal(served(), wellFormed(command));

        expect(run.exitCode).toBe(NOT_BUILT);
        expect(run.lines.join("\n")).toContain("not built");
      },
    );

    it("names exactly the missing tables of each command's slice", async () => {
      expect([...SLICE_COMMANDS].toSorted()).toEqual(Object.keys(SLICE_TABLES).toSorted());

      for (const [command, tables] of Object.entries(SLICE_TABLES)) {
        const run = await opsBeforeTheJournal(served(), wellFormed(command));
        const absent = tables.map((table) => getTableName(table)).join(", ");

        expect({ command, exitCode: run.exitCode, said: run.lines }).toEqual({
          command,
          exitCode: NOT_BUILT,
          said: [
            `${command}: not built — the database is missing these tables: ${absent}. Run the migrations that create them.`,
          ],
        });
      }
    });

    it("prints no other command's name in its output", async () => {
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

    describe("on the synthetic workspace the restore drill leaves", () => {
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
            "object-store-orphans: done — found 0 objects older than 24 hours that no document names, and removed none",
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
            "erasure-rehearsal: REFUSED — this workspace has no synthetic subject. Either phase one (--seed) has not run here, or its subject is already erased.",
        },
      ])(
        "$command accepts the synthetic workspace id from the drill",
        async ({ command, flags, exitCode, first }) => {
          const run = await ops(served(), [command, "--workspace", synthetic, ...flags]);

          expect({ exitCode: run.exitCode, first: run.lines[0] }).toEqual({ exitCode, first });
        },
      );
    });
  });
});
