import { describe, expect, it } from "vitest";

import { connectUpload, connectUploadFields } from "@better-answers/core/sources";
import { listObjects } from "@better-answers/core/store/objects";
import { openPostgres } from "@better-answers/core/store/postgres";
import { inputOf } from "@better-answers/core/testing/input";
import { objectStoreForSuite } from "@better-answers/core/testing/objects";
import { whileWritesAreRefused } from "@better-answers/core/testing/postgres";
import { ulid } from "@better-answers/schema";

import { EXIT_OF_CLASS } from "../../src/ops/index.ts";
import { opsRunner, whatAReplayReaches, principalOf } from "../support/ops-run.ts";
import { servedApp } from "../support/suite-app.ts";

const objects = objectStoreForSuite();
const { ops, opsWith, boundAndIndexed } = opsRunner(objects);

describe("pnpm ops — the restore scripts' commands", () => {
  const served = servedApp();

  describe("object-store-orphans — the bytes a failed connect left", () => {
    /**
     * The store stamps an object with its own clock, so the instant the grace is judged from is
     * the suite's own, moved on.
     */
    const aDayOn = (): Date => new Date(Date.now() + 25 * 60 * 60 * 1000);

    const handbook = () => ({
      ...inputOf(connectUploadFields, {
        connectedSourceId: ulid(),
        name: "The staff handbook",
        fileName: "handbook.md",
        mediaType: "text/markdown",
        byteSize: 43,
      }),
      body: new Blob(["The handbook says what the company decided."]).stream(),
    });

    const connectedSourcesOf = async (workspaceId: string, userId: string) => {
      const admin = await principalOf(served(), workspaceId, userId);
      const doors = { postgres: openPostgres(served().database.pool), objects: objects().door };

      const bound = await connectUpload(admin, doors, handbook());
      if (!bound.ok) throw new Error(`the connect was refused: ${String(bound.error)}`);

      const failed = await whileWritesAreRefused(served().database.superuser, "job", () =>
        connectUpload(admin, doors, handbook()),
      );
      if (failed.ok) throw new Error("the connect landed where the queue was refused");
      return { admin, named: bound.value.originalKey };
    };

    it("removes only the original no document names, once past grace", async () => {
      const { workspaceId, admin: person } = await served().provision();
      const { admin, named } = await connectedSourcesOf(workspaceId, person.id);

      const looked = await opsWith(
        served(),
        ["object-store-orphans", "--workspace", workspaceId, "--list"],
        { doors: { clock: { now: aDayOn } } },
      );
      expect(looked.exitCode).toBe(0);
      expect(looked.lines).toEqual([
        "object-store-orphans: done — 1 object past the 24-hour grace no document names, removed none",
      ]);

      const run = await opsWith(served(), ["object-store-orphans", "--workspace", workspaceId], {
        doors: { clock: { now: aDayOn } },
      });

      expect(run.exitCode).toBe(0);
      expect(run.lines).toEqual([
        "object-store-orphans: done — removed 1 object past the 24-hour grace no document names",
      ]);
      expect(await listObjects(admin, objects().door, "")).toEqual({ ok: true, value: [named] });
    });

    it("removes nothing while the grace still holds over both", async () => {
      const { workspaceId, admin: person } = await served().provision();
      await connectedSourcesOf(workspaceId, person.id);

      const run = await ops(served(), ["object-store-orphans", "--workspace", workspaceId]);

      expect(run.exitCode).toBe(0);
      expect(run.lines).toEqual([
        "object-store-orphans: done — removed 0 objects past the 24-hour grace no document names",
      ]);
    });

    it("crosses its refusal as word and class code, removing nothing", async () => {
      const run = await ops(served(), ["object-store-orphans", "--workspace", "ws_synthetic"]);

      expect(run.exitCode).toBe(EXIT_OF_CLASS.malformed);
      expect(run.lines).toEqual([
        "object-store-orphans: REFUSED — malformed: --workspace ws_synthetic is not a workspace id",
      ]);
    });

    it("refuses when the image has no object store to sweep", async () => {
      const { workspaceId } = await served().provision();

      const run = await opsWith(
        served(),
        ["object-store-orphans", "--workspace", workspaceId],
        { doors: { objects: undefined } },
        served().database.superuser,
      );

      expect(run.exitCode).toBe(1);
      expect(run.lines.join("\n")).toContain("no object store is configured");
    });
  });

  describe("reindex-connected-sources — every source wiped and queued again", () => {
    it("wipes an indexed source and queues its wiped sync", async () => {
      const { workspaceId, admin } = await served().provision();
      await boundAndIndexed(served(), workspaceId, admin.id, "Expense claims are paid monthly.\n");

      const run = await ops(served(), ["reindex-connected-sources", "--workspace", workspaceId]);
      const after = await whatAReplayReaches(served(), workspaceId);

      expect(run.exitCode).toBe(0);
      expect(run.lines).toEqual([
        "reindex-connected-sources: done — 1 connected source wiped (1 passage) and queued to index again",
      ]);
      expect(after.passages).toEqual([]);
      expect(after.jobs.at(-1)).toEqual({ kind: "index", reason: "wiped", status: "queued" });
    });

    it("says so when the workspace holds no connected source", async () => {
      const { workspaceId } = await served().provision();

      const run = await ops(served(), ["reindex-connected-sources", "--workspace", workspaceId]);

      expect(run.exitCode).toBe(0);
      expect(run.lines).toEqual([
        "reindex-connected-sources: done — no connected source to reindex",
      ]);
    });

    it("answers usage to a non-id workspace before wiping anything", async () => {
      const run = await ops(served(), ["reindex-connected-sources", "--workspace", "ws_synthetic"]);

      expect(run.exitCode).toBe(2);
    });
  });
});
