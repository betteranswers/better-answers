import type pg from "pg";
import { describe, expect, it } from "vitest";

import { AUDIENCE_EVERYONE, AUDIENCE_GROUPS, SENSITIVITIES, ulid } from "../src/index.ts";
import { testData } from "./factory.ts";
import { withRollback } from "./harness.ts";
import { postgresForSuite, privilegesHeld, refusesEach } from "./probes.ts";

const db = postgresForSuite();

const WS_A = "01J6EAAAAAAAAAAAAAAAAAAAAA";
const WS_B = "01J6EBBBBBBBBBBBBBBBBBBBBB";

// Spelled here, not imported: `packages/core` owns the builder and depends on this package,
// so the arrow points one way.
const READABLE = `SELECT id FROM "index".readable_chunk AS v
     WHERE v.published_at IS NOT NULL
       AND (v.sensitivity <> 'Restricted' OR $1 = 'Admin')
       AND (v.audience = 'everyone' OR v.audience_groups && $2::text[])
     ORDER BY id`;

const THE_VIEW = `SELECT id, sensitivity, published_at, audience, audience_groups
     FROM "index".readable_chunk ORDER BY id`;

const byId = (one: { readonly id: string }, other: { readonly id: string }): number =>
  one.id < other.id ? -1 : 1;

const publishedToEveryone = (row: { readonly id: string; readonly sensitivity: string }) => ({
  ...row,
  published_at: expect.any(Date),
  audience: AUDIENCE_EVERYONE,
  audience_groups: null,
});

type Reader = readonly [role: string, groups: readonly string[]];

const ADMIN: Reader = ["Admin", []];

const VIEWER: Reader = ["Viewer", []];

const asAppRt = async (client: pg.PoolClient, workspaceId: string): Promise<void> => {
  await client.query("SET LOCAL ROLE app_rt");
  await client.query("SELECT set_config('app.workspace_id', $1, true)", [workspaceId]);
};

const seenBy = async (
  client: pg.PoolClient,
  [role, groups]: Reader,
): Promise<readonly string[]> => {
  const read = await client.query<{ id: string }>(READABLE, [role, [...groups]]);
  return read.rows.map((row) => row.id);
};

type Arrangement = {
  readonly workspaceId?: string;
  readonly bindingClass?: string | undefined;
  readonly documentClass?: string | null | undefined;
  readonly audience?: string | undefined;
  readonly audienceGroups?: readonly string[] | undefined;
  readonly publishedAt?: Date | null | undefined;
  readonly withoutADocument?: boolean | undefined;
};

const aChunkUnderABinding = async (client: pg.PoolClient, arrangement: Arrangement = {}) => {
  const workspaceId = arrangement.workspaceId ?? WS_A;
  const seed = testData(client);
  const binding = await seed.sourceBinding({
    workspaceId,
    sensitivity: arrangement.bindingClass ?? "Internal",
    audience: arrangement.audience ?? AUDIENCE_EVERYONE,
    audienceGroups: arrangement.audienceGroups ? [...arrangement.audienceGroups] : null,
    publishedAt: arrangement.publishedAt === undefined ? new Date() : arrangement.publishedAt,
  });
  const document = arrangement.withoutADocument
    ? undefined
    : await seed.sourceDocument({
        workspaceId,
        bindingId: binding.id,
        sensitivity: arrangement.documentClass ?? null,
      });
  const chunk = await seed.chunk({
    workspaceId,
    bindingId: binding.id,
    sourceDocumentId: document?.id ?? null,
  });
  return { binding, document, chunk };
};

const twoWorkspaces = async (client: pg.PoolClient): Promise<void> => {
  const seed = testData(client);
  await seed.workspace({ id: WS_A, name: "A" });
  await seed.workspace({ id: WS_B, name: "B" });
};

const THE_FOUR_TERMS = ["published_at", "sensitivity", "audience", "audience_groups"];

const columnsOf = async (relation: string): Promise<readonly string[]> => {
  const read = await db().pool.query<{ column: string }>(
    `SELECT a.attname AS column FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'index' AND c.relname = $1 AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY a.attname`,
    [relation],
  );
  return read.rows.map((row) => row.column);
};

const THE_FOLD = [
  { binding: "Restricted", document: "Restricted", narrower: "Restricted", viewer: false },
  { binding: "Restricted", document: "Internal", narrower: "Restricted", viewer: false },
  { binding: "Restricted", document: "Public", narrower: "Restricted", viewer: false },
  { binding: "Internal", document: "Restricted", narrower: "Restricted", viewer: false },
  { binding: "Internal", document: "Internal", narrower: "Internal", viewer: true },
  { binding: "Internal", document: "Public", narrower: "Internal", viewer: true },
  { binding: "Public", document: "Restricted", narrower: "Restricted", viewer: false },
  { binding: "Public", document: "Internal", narrower: "Internal", viewer: true },
  { binding: "Public", document: "Public", narrower: "Public", viewer: true },
] as const;

const THE_DOCUMENT_NAMES_NO_CLASS = [
  { binding: "Restricted", document: null, narrower: "Restricted", viewer: false },
  { binding: "Internal", document: null, narrower: "Internal", viewer: true },
  { binding: "Public", document: null, narrower: "Public", viewer: true },
] as const;

const A_WORD_OUTSIDE_THE_SET = [
  { binding: "Secret", document: "Public", narrower: null },
  { binding: "Public", document: "Secret", narrower: null },
  { binding: "Secret", document: null, narrower: null },
  { binding: null, document: "Public", narrower: null },
  { binding: null, document: null, narrower: null },
] as const;

const THE_FOLD_AT_ITS_EDGES = [...THE_DOCUMENT_NAMES_NO_CLASS, ...A_WORD_OUTSIDE_THE_SET];

const folded = async (
  client: pg.PoolClient,
  pairs: readonly { readonly binding: string | null; readonly document: string | null }[],
): Promise<readonly (string | null)[]> => {
  const answered = await client.query<{ narrower: string | null }>(
    `SELECT narrower_class(pair.a, pair.b) AS narrower
       FROM unnest($1::text[], $2::text[]) WITH ORDINALITY AS pair(a, b, at)
      ORDER BY pair.at`,
    [pairs.map((pair) => pair.binding), pairs.map((pair) => pair.document)],
  );
  return answered.rows.map((row) => row.narrower);
};

describe("the one SQL statement of the class ranking", () => {
  it("answers the narrower of two classes, for every pair in the ranking and in both orders", async () => {
    await withRollback(db().pool, async (client) => {
      expect(await folded(client, THE_FOLD)).toEqual(THE_FOLD.map((pair) => pair.narrower));
    });
  });

  it("answers the binding's class where the document names none, and nothing for a word outside the set", async () => {
    await withRollback(db().pool, async (client) => {
      expect(await folded(client, THE_FOLD_AT_ITS_EDGES)).toEqual(
        THE_FOLD_AT_ITS_EDGES.map((pair) => pair.narrower),
      );
    });
  });

  it("ranks the three classes this package declares and no fourth", () => {
    const ranked = new Set(THE_FOLD.flatMap((pair) => [pair.binding, pair.document]));

    expect([...ranked].toSorted()).toEqual([...SENSITIVITIES].toSorted());
  });

  it("is immutable and pinned, so a caller's own object cannot shadow what the ranking counts with", async () => {
    const read = await db().pool.query<{ volatile: string; settings: string[] | null }>(
      `SELECT p.provolatile AS volatile, p.proconfig AS settings
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'narrower_class'`,
    );

    expect(read.rows).toEqual([{ volatile: "i", settings: ["search_path=pg_catalog, pg_temp"] }]);
  });

  it("folds a pair for the worker, which may call it and may not read the view it answers for", async () => {
    await withRollback(db().pool, async (client) => {
      await twoWorkspaces(client);
      await aChunkUnderABinding(client, { bindingClass: "Public" });
      await client.query("SET LOCAL ROLE worker_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);

      const served = await client.query<{ narrower: string }>(
        "SELECT narrower_class('Public', 'Internal') AS narrower",
      );
      await refusesEach(client, [
        [THE_VIEW, "worker_rt reading the view the fold answers a class for"],
      ]);

      expect(served.rows).toEqual([{ narrower: "Internal" }]);
    });
  });

  it("is executable by both runtime roles and not by PUBLIC", async () => {
    const read = await db().pool.query<{ role: string; held: boolean }>(
      `SELECT role, has_function_privilege(role, 'public.narrower_class(text, text)', 'EXECUTE') AS held
         FROM unnest(ARRAY['app_rt', 'worker_rt']) AS role`,
    );
    const toPublic = await db().pool.query(
      `SELECT 1 FROM pg_proc p, LATERAL aclexplode(p.proacl) AS a
        WHERE p.proname = 'narrower_class' AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'`,
    );

    expect({ held: read.rows, toPublic: toPublic.rowCount }).toEqual({
      held: [
        { role: "app_rt", held: true },
        { role: "worker_rt", held: true },
      ],
      toPublic: 0,
    });
  });
});

describe("the shape the view presents", () => {
  it("presents every column of the chunk a reader still needs, and the four visibility terms beside them", async () => {
    const [onTheChunk, onTheView] = await Promise.all([
      columnsOf("chunk"),
      columnsOf("readable_chunk"),
    ]);

    expect({
      missing: onTheChunk.filter(
        (column) => !THE_FOUR_TERMS.includes(column) && !onTheView.includes(column),
      ),
      unexpected: onTheView.filter(
        (column) => !THE_FOUR_TERMS.includes(column) && !onTheChunk.includes(column),
      ),
      terms: THE_FOUR_TERMS.filter((column) => onTheView.includes(column)),
    }).toEqual({ missing: [], unexpected: [], terms: THE_FOUR_TERMS });
  });

  // From the definition, not a plan: at this suite's row counts a sequential scan is the
  // right plan whether or not the workspace id prunes.
  it("joins the binding inner and the document left, each on the workspace id beside the id", async () => {
    const read = await db().pool.query<{ definition: string }>(
      `SELECT pg_get_viewdef('"index".readable_chunk'::regclass, true) AS definition`,
    );
    const written = (read.rows[0]?.definition ?? "").replaceAll(/\s+/gu, " ");

    expect({
      binding: written.includes(
        "JOIN source_binding b ON b.workspace_id = c.workspace_id AND b.id = c.binding_id",
      ),
      document: written.includes(
        "LEFT JOIN source_document d ON d.workspace_id = c.workspace_id AND d.id = c.source_document_id",
      ),
    }).toEqual({ binding: true, document: true });
  });

  it("is read under the caller's own privileges, with no barrier in the planner's way", async () => {
    const read = await db().pool.query<{ options: string[] | null }>(
      `SELECT c.reloptions AS options FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'index' AND c.relname = 'readable_chunk'`,
    );

    expect(read.rows).toEqual([{ options: ["security_invoker=true"] }]);
  });
});

describe("what the view reports for a chunk, as app_rt under RLS", () => {
  it("reports the narrower of the binding's class and the document's, and shows the row to a reader who may read it", async () => {
    await withRollback(db().pool, async (client) => {
      await twoWorkspaces(client);
      const landed: { readonly id: string; readonly expected: string; readonly viewer: boolean }[] =
        [];
      for (const pair of [...THE_FOLD, ...THE_DOCUMENT_NAMES_NO_CLASS]) {
        const { chunk } = await aChunkUnderABinding(client, {
          bindingClass: pair.binding,
          documentClass: pair.document,
        });
        landed.push({ id: chunk.id, expected: pair.narrower, viewer: pair.viewer });
      }
      await asAppRt(client, WS_A);

      const reported = await client.query<{ id: string; sensitivity: string }>(THE_VIEW);

      expect(
        reported.rows.map((row) => ({ id: row.id, sensitivity: row.sensitivity })).toSorted(byId),
      ).toEqual(landed.map(({ id, expected }) => ({ id, sensitivity: expected })).toSorted(byId));
      expect({
        admin: (await seenBy(client, ADMIN)).toSorted(),
        viewer: (await seenBy(client, VIEWER)).toSorted(),
      }).toEqual({
        admin: landed.map(({ id }) => id).toSorted(),
        viewer: landed
          .filter(({ viewer }) => viewer)
          .map(({ id }) => id)
          .toSorted(),
      });
    });
  });

  it("carries the binding's audience, so a reader in the named group reads it and a reader outside it does not", async () => {
    await withRollback(db().pool, async (client) => {
      await twoWorkspaces(client);
      const held = ulid();
      const unheld = ulid();
      const everyone = await aChunkUnderABinding(client);
      const toTheGroup = await aChunkUnderABinding(client, {
        audience: AUDIENCE_GROUPS,
        audienceGroups: [held],
      });
      await asAppRt(client, WS_A);

      expect({
        inTheGroup: await seenBy(client, ["Viewer", [held]]),
        outsideIt: await seenBy(client, ["Viewer", [unheld]]),
        audience: (await client.query<{ audience: string }>(THE_VIEW)).rows.map(
          (row) => row.audience,
        ),
      }).toEqual({
        inTheGroup: [everyone.chunk.id, toTheGroup.chunk.id].toSorted(),
        outsideIt: [everyone.chunk.id],
        audience: expect.arrayContaining([AUDIENCE_EVERYONE, AUDIENCE_GROUPS]),
      });
    });
  });

  it("carries the binding's publish stamp, so an unpublished binding's chunk is read by nobody and a published one's by a reader", async () => {
    await withRollback(db().pool, async (client) => {
      await twoWorkspaces(client);
      await aChunkUnderABinding(client, { publishedAt: null });
      const published = await aChunkUnderABinding(client);
      await asAppRt(client, WS_A);

      expect({
        stamps: (await client.query<{ published_at: Date | null }>(THE_VIEW)).rows.filter(
          (row) => row.published_at === null,
        ).length,
        admin: await seenBy(client, ADMIN),
        viewer: await seenBy(client, VIEWER),
      }).toEqual({
        stamps: 1,
        admin: [published.chunk.id],
        viewer: [published.chunk.id],
      });
    });
  });

  it("reads the binding as it stands now, so a narrowing after the row was landed is seen at once", async () => {
    await withRollback(db().pool, async (client) => {
      await twoWorkspaces(client);
      const { binding, chunk } = await aChunkUnderABinding(client, { bindingClass: "Public" });
      await asAppRt(client, WS_A);
      const before = await client.query<{ sensitivity: string }>(THE_VIEW);

      await client.query("RESET ROLE");
      await client.query("UPDATE source_binding SET sensitivity = 'Restricted' WHERE id = $1", [
        binding.id,
      ]);
      await asAppRt(client, WS_A);

      const after = await client.query<{ sensitivity: string }>(THE_VIEW);

      expect({
        before: before.rows[0]?.sensitivity,
        after: after.rows[0]?.sensitivity,
        viewer: await seenBy(client, VIEWER),
        admin: await seenBy(client, ADMIN),
      }).toEqual({
        before: "Public",
        after: "Restricted",
        viewer: [],
        admin: [chunk.id],
      });
    });
  });
});

describe("what the view withholds", () => {
  it("shows a reader scoped to one workspace nothing of another's, whatever that workspace holds", async () => {
    await withRollback(db().pool, async (client) => {
      await twoWorkspaces(client);
      const mine = await aChunkUnderABinding(client, { bindingClass: "Public" });
      const theirs = await aChunkUnderABinding(client, {
        workspaceId: WS_B,
        bindingClass: "Public",
      });
      await asAppRt(client, WS_A);

      const scoped = await client.query<{ id: string }>(THE_VIEW);
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_B]);
      const theOther = await client.query<{ id: string }>(THE_VIEW);
      await client.query("SELECT set_config('app.workspace_id', '', true)");
      const unscoped = await client.query<{ id: string }>(THE_VIEW);

      expect({
        scoped: scoped.rows.map((row) => row.id),
        theOther: theOther.rows.map((row) => row.id),
        unscoped: unscoped.rows.map((row) => row.id),
      }).toEqual({ scoped: [mine.chunk.id], theOther: [theirs.chunk.id], unscoped: [] });
    });
  });

  it("drops a chunk whose binding row has gone, while its neighbour under a live binding still reads", async () => {
    await withRollback(db().pool, async (client) => {
      await twoWorkspaces(client);
      // A chunk naming a document cascades away with the binding; one naming none outlives
      // it, and the inner join is what withholds it.
      const orphaned = await aChunkUnderABinding(client, {
        bindingClass: "Public",
        withoutADocument: true,
      });
      const neighbour = await aChunkUnderABinding(client, { bindingClass: "Public" });
      await client.query("DELETE FROM source_binding WHERE id = $1", [orphaned.binding.id]);
      const standing = await client.query('SELECT id FROM "index".chunk WHERE id = $1', [
        orphaned.chunk.id,
      ]);
      await asAppRt(client, WS_A);

      expect({
        chunkRowStands: standing.rowCount,
        throughTheView: (await client.query<{ id: string }>(THE_VIEW)).rows.map((row) => row.id),
        readable: await seenBy(client, ADMIN),
      }).toEqual({
        chunkRowStands: 1,
        throughTheView: [neighbour.chunk.id],
        readable: [neighbour.chunk.id],
      });
    });
  });

  it("keeps a chunk that names no document, reading it at its binding's own class", async () => {
    await withRollback(db().pool, async (client) => {
      await twoWorkspaces(client);
      const { chunk } = await aChunkUnderABinding(client, {
        bindingClass: "Public",
        withoutADocument: true,
      });
      await asAppRt(client, WS_A);

      const reported = await client.query<{ id: string; sensitivity: string }>(THE_VIEW);

      expect(reported.rows).toEqual(
        [{ id: chunk.id, sensitivity: "Public" }].map(publishedToEveryone),
      );
      expect(await seenBy(client, VIEWER)).toEqual([chunk.id]);
    });
  });
});

describe("who may read the view", () => {
  it("is selected by app_rt and refused to worker_rt, which holds nothing on it at all", async () => {
    await withRollback(db().pool, async (client) => {
      await twoWorkspaces(client);
      const { chunk } = await aChunkUnderABinding(client, { bindingClass: "Public" });

      const forTheApp = await privilegesHeld(client, "app_rt", '"index".readable_chunk');
      const forTheWorker = await privilegesHeld(client, "worker_rt", '"index".readable_chunk');

      await client.query("SET LOCAL ROLE worker_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
      await refusesEach(client, [
        [THE_VIEW, "worker_rt selecting the view the app reads a chunk through"],
      ]);
      await client.query("RESET ROLE");

      await asAppRt(client, WS_A);
      const served = await client.query<{ id: string }>(THE_VIEW);

      expect({ forTheApp, forTheWorker, served: served.rows.map((row) => row.id) }).toEqual({
        forTheApp: {
          SELECT: true,
          INSERT: false,
          UPDATE: false,
          DELETE: false,
          TRUNCATE: false,
          REFERENCES: false,
          TRIGGER: false,
          MAINTAIN: false,
        },
        forTheWorker: {
          SELECT: false,
          INSERT: false,
          UPDATE: false,
          DELETE: false,
          TRUNCATE: false,
          REFERENCES: false,
          TRIGGER: false,
          MAINTAIN: false,
        },
        served: [chunk.id],
      });
    });
  });
});

describe("a partition attached after the view was made", () => {
  it("reads through it exactly as the partition that was there first does", async () => {
    await withRollback(db().pool, async (client) => {
      await twoWorkspaces(client);
      const first = await aChunkUnderABinding(client, { bindingClass: "Public" });
      await asAppRt(client, WS_A);
      const before = await seenBy(client, VIEWER);

      await client.query("RESET ROLE");
      const later = await aChunkUnderABinding(client, {
        workspaceId: WS_B,
        bindingClass: "Public",
      });
      await asAppRt(client, WS_B);

      expect({ before, after: await seenBy(client, VIEWER) }).toEqual({
        before: [first.chunk.id],
        after: [later.chunk.id],
      });
    });
  });
});
