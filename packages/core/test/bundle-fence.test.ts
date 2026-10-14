import pg from "pg";
import { describe, expect, it } from "vitest";

import { ulid } from "@better-answers/schema";

import {
  RECONCILER,
  reconcile,
  writeConcept,
  writeManifest,
  type WriteConceptInput,
  type WriteManifestInput,
} from "../src/concepts/index.ts";
import {
  FENCE_HOLDERS_PER_POOL,
  openPostgres,
  tryWorkspaceFence,
  withIdentityRead,
  withWorkspaceFence,
} from "../src/store/postgres/index.ts";
import { rewritingElsewhere, writingElsewhere } from "./bundle-fence.ts";
import { bootstrap } from "./platform.ts";
import { statementsWaitingOnALock, until } from "./suite-postgres.ts";
import { doorsOf, suiteWithBundles, type Scenario } from "./workspace-with-bundle.ts";

const { db, arrange } = suiteWithBundles();

const A_GUIDELINE: WriteConceptInput = {
  mergeKey: "guideline:kettles",
  path: "knowledge/guidelines/kettles.md",
  kind: "Guideline",
  title: "Kettles",
  frontmatter: { title: "Kettles", type: "Guideline", tags: ["kitchen"] },
  body: "# Kettles\n\nDescale the kettle every month.",
  message: "Record the kettles guideline",
  author: { name: "Grace Editor", email: "grace@acme.invalid" },
  expects: { head: null },
  status: "stable",
  sensitivity: "Internal",
};

const A_MANIFEST: WriteManifestInput = {
  manifest: {
    id: "01J6BBBBBBBBBBBBBBBBBBBBBB",
    origin: "company",
    ref: "Four bid libraries, reviewed 22 September 2026",
    owner: "Acme",
    content_version: "2026-09-22",
  },
  message: "Write the bundle's manifest",
  author: { name: "Grace Editor", email: "grace@acme.invalid" },
};

const waitingOnTheFence = async (): Promise<boolean> =>
  (await statementsWaitingOnALock(db().pool)).some((query) => query.includes("hashtext('bundle')"));

const STILL_WAITING = "still waiting";

/** Long enough for a refusal that waits on nothing, short against the forty-five a waiter gets. */
const PROMPTLY_MS = 2_000;

const promptly = <T>(answer: Promise<T>): Promise<T | typeof STILL_WAITING> =>
  Promise.race([
    answer,
    new Promise<typeof STILL_WAITING>((resolve) =>
      setTimeout(() => resolve(STILL_WAITING), PROMPTLY_MS),
    ),
  ]);

/** NOWAIT, so a row a waiter still held would answer at once rather than queueing behind it. */
const theMemberRowIsFree = async (scenario: Scenario): Promise<boolean> => {
  const probe = await db().pool.connect();
  try {
    await probe.query("BEGIN");
    await probe.query(
      "SELECT 1 FROM member WHERE workspace_id = $1 AND user_id = $2 FOR UPDATE NOWAIT",
      [scenario.workspaceId, scenario.editor.userId],
    );
    return true;
  } catch {
    return false;
  } finally {
    await probe.query("ROLLBACK");
    probe.release();
  }
};

/** A writer parked on the fence behind a rewrite elsewhere, and the rewrite's release. */
const writerParkedBehindARewrite = async (scenario: Scenario) => {
  const rewriting = await rewritingElsewhere(db().pool, scenario.workspaceId);
  const writing = writeConcept(scenario.editor, doorsOf(scenario), A_GUIDELINE);
  await until(waitingOnTheFence);
  return { writing, release: rewriting.release };
};

const reconciling = (scenario: Scenario) =>
  reconcile(RECONCILER, doorsOf(scenario), { workspaceId: scenario.workspaceId });

describe("a bundle another process is rewriting", () => {
  it("holds a concept write until the rewrite ends", async () => {
    const scenario = await arrange();
    const { writing, release } = await writerParkedBehindARewrite(scenario);

    await release();

    expect(await writing).toMatchObject({ ok: true });
  });

  it("holds a manifest write until the rewrite ends", async () => {
    const scenario = await arrange();
    const rewriting = await rewritingElsewhere(db().pool, scenario.workspaceId);

    const writing = writeManifest(scenario.editor, doorsOf(scenario), A_MANIFEST);
    await until(waitingOnTheFence);
    await rewriting.release();

    expect(await writing).toMatchObject({ ok: true, value: { written: true } });
  });

  it("leaves a writer waiting on the fence holding no row", async () => {
    const scenario = await arrange();
    const { writing, release } = await writerParkedBehindARewrite(scenario);

    const free = await theMemberRowIsFree(scenario);
    await release();

    expect(free).toBe(true);
    expect(await writing).toMatchObject({ ok: true });
  });

  it("skips a reconciler tick queued behind a parked writer", async () => {
    const scenario = await arrange();
    const { writing, release } = await writerParkedBehindARewrite(scenario);

    const answered = await promptly(reconciling(scenario));
    await release();
    await writing;

    expect(answered).toEqual({ ok: false, error: "held" });
  });
});

describe("the reconciler beside a write elsewhere", () => {
  it("shares the bundle with a write under way", async () => {
    const scenario = await arrange();
    const writing = await writingElsewhere(db().pool, scenario.workspaceId);

    const answered = await promptly(reconciling(scenario));
    await writing.release();

    expect(answered).toMatchObject({ ok: true });
  });
});

describe("the fence's slots", () => {
  /** A pool of its own, so the slots a case counts are its own. */
  const aSmallPool = () => new pg.Pool({ ...db().pool.options, max: FENCE_HOLDERS_PER_POOL + 1 });

  it("frees the lock and the slot when the work throws", async () => {
    const small = aSmallPool();
    const door = openPostgres(small);
    const workspaceId = ulid();

    const thrown = await Promise.allSettled(
      Array.from({ length: FENCE_HOLDERS_PER_POOL + 1 }, () =>
        withWorkspaceFence(bootstrap, door, workspaceId, "shared", () =>
          Promise.reject(new Error("the work failed")),
        ),
      ),
    );
    const after = await withWorkspaceFence(bootstrap, door, workspaceId, "shared", async () => 1);
    const alone = await tryWorkspaceFence(bootstrap, door, workspaceId, "exclusive", async () => 2);
    await small.end();

    expect(thrown.every((settled) => settled.status === "rejected")).toBe(true);
    expect(after).toBe(1);
    expect(alone).toEqual({ ok: true, value: 2 });
  });

  it("answers held at once when every slot is taken", async () => {
    const small = aSmallPool();
    const door = openPostgres(small);
    let open = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const busy = Array.from({ length: FENCE_HOLDERS_PER_POOL }, () =>
      withWorkspaceFence(bootstrap, door, ulid(), "shared", () => gate),
    );

    const answered = await promptly(
      tryWorkspaceFence(bootstrap, door, ulid(), "shared", async () => 1),
    );
    open();
    await Promise.all(busy);
    await small.end();

    expect(answered).toEqual({ ok: false, error: "held" });
  });

  /** A run starts its holders together; a slow connect can keep one from overlapping the rest. */
  const holdersAtOnce = async (): Promise<{ readonly most: number; readonly finished: number }> => {
    const small = aSmallPool();
    const door = openPostgres(small);
    let inside = 0;
    let most = 0;
    let finished = 0;
    await Promise.all(
      Array.from({ length: FENCE_HOLDERS_PER_POOL * 4 }, () =>
        withWorkspaceFence(bootstrap, door, ulid(), "shared", async () => {
          inside += 1;
          most = Math.max(most, inside);
          await withIdentityRead(bootstrap, door, (tx) => tx.query("SELECT pg_sleep(0.05)"));
          inside -= 1;
          finished += 1;
        }),
      ),
    );
    await small.end();
    return { most, finished };
  };

  it("never holds more than the cap, and every holder finishes", async () => {
    const runs = [await holdersAtOnce(), await holdersAtOnce(), await holdersAtOnce()];

    for (const run of runs) {
      expect(run.most).toBeLessThanOrEqual(FENCE_HOLDERS_PER_POOL);
      expect(run.finished).toBe(FENCE_HOLDERS_PER_POOL * 4);
    }
    expect(runs.some((run) => run.most === FENCE_HOLDERS_PER_POOL)).toBe(true);
  });
});
