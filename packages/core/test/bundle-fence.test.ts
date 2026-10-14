import pg from "pg";
import { describe, expect, it } from "vitest";

import { ulid } from "@better-answers/schema";

import { writeConcept, type WriteConceptInput } from "../src/concepts/index.ts";
import {
  FENCE_HOLDERS_PER_POOL,
  openPostgres,
  withIdentityRead,
  withWorkspaceFence,
} from "../src/store/postgres/index.ts";
import { rewritingElsewhere } from "./bundle-fence.ts";
import { bootstrap } from "./platform.ts";
import { statementsWaitingOnALock, until } from "./suite-postgres.ts";
import { doorsOf, suiteWithBundles } from "./workspace-with-bundle.ts";

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

const waitingOnTheFence = async (): Promise<boolean> =>
  (await statementsWaitingOnALock(db().pool)).some((query) => query.includes("hashtext('bundle')"));

describe("the bundle fence", () => {
  it("holds a write while another process rewrites the bundle", async () => {
    const scenario = await arrange();
    const rewriting = await rewritingElsewhere(db().pool, scenario.workspaceId);

    const writing = writeConcept(scenario.editor, doorsOf(scenario), A_GUIDELINE);
    await until(waitingOnTheFence);
    await rewriting.release();

    expect(await writing).toMatchObject({ ok: true });
  });

  it("holds no more fence holders at once than the cap", async () => {
    const small = new pg.Pool({ ...db().pool.options, max: FENCE_HOLDERS_PER_POOL + 1 });
    const door = openPostgres(small);
    let inside = 0;
    let most = 0;

    const writers = Array.from({ length: FENCE_HOLDERS_PER_POOL * 4 }, () =>
      withWorkspaceFence(bootstrap, door, ulid(), "shared", async () => {
        inside += 1;
        most = Math.max(most, inside);
        await withIdentityRead(bootstrap, door, (tx) => tx.query("SELECT pg_sleep(0.05)"));
        inside -= 1;
      }),
    );
    await Promise.all(writers);
    await small.end();

    expect(most).toBe(FENCE_HOLDERS_PER_POOL);
  });
});
