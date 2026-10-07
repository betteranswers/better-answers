import type pg from "pg";
import { describe, expect, it } from "vitest";

import { AUDIENCE_EVERYONE, AUDIENCE_GROUPS, SENSITIVITIES, ulid } from "../src/index.ts";
import { testData } from "./factory.ts";
import { withRollback } from "./harness.ts";
import { postgresForSuite, privilegesHeld, refusesEach } from "./probes.ts";

const db = postgresForSuite();

const WS_A = "01J6EAAAAAAAAAAAAAAAAAAAAA";
const WS_B = "01J6EBBBBBBBBBBBBBBBBBBBBB";

/**
 * Spelled here, not imported: `packages/core` owns the builder and depends on this package,
 * so the arrow points one way.
 */
const READABLE = `SELECT id FROM "index".readable_passage AS v
     WHERE v.published_at IS NOT NULL
       AND (v.sensitivity <> 'Restricted' OR $1 = 'Admin')
       AND (v.audience = 'everyone' OR v.audience_groups && $2::text[])
     ORDER BY id`;

const THE_VIEW = `SELECT id, sensitivity, published_at, audience, audience_groups
     FROM "index".readable_passage ORDER BY id`;

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
  readonly connectedSourceSensitivity?: string | undefined;
  readonly documentSensitivity?: string | null | undefined;
  readonly audience?: string | undefined;
  readonly audienceGroups?: readonly string[] | undefined;
  readonly publishedAt?: Date | null | undefined;
  readonly withoutADocument?: boolean | undefined;
};

const connectedSourceArranged = (workspaceId: string, arrangement: Arrangement) => ({
  workspaceId,
  sensitivity: arrangement.connectedSourceSensitivity ?? "Internal",
  audience: arrangement.audience ?? AUDIENCE_EVERYONE,
  audienceGroups: arrangement.audienceGroups ? [...arrangement.audienceGroups] : null,
  publishedAt: arrangement.publishedAt === undefined ? new Date() : arrangement.publishedAt,
});

const aPassageUnderAConnectedSource = async (
  client: pg.PoolClient,
  arrangement: Arrangement = {},
) => {
  const workspaceId = arrangement.workspaceId ?? WS_A;
  const seed = testData(client);
  const connectedSource = await seed.connectedSource(
    connectedSourceArranged(workspaceId, arrangement),
  );
  const document = arrangement.withoutADocument
    ? undefined
    : await seed.sourceDocument({
        workspaceId,
        connectedSourceId: connectedSource.id,
        sensitivity: arrangement.documentSensitivity ?? null,
      });
  const passage = await seed.passage({
    workspaceId,
    connectedSourceId: connectedSource.id,
    sourceDocumentId: document?.id ?? null,
  });
  return { connectedSource, document, passage };
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
  { connectedSource: "Restricted", document: "Restricted", narrower: "Restricted", viewer: false },
  { connectedSource: "Restricted", document: "Internal", narrower: "Restricted", viewer: false },
  { connectedSource: "Restricted", document: "Public", narrower: "Restricted", viewer: false },
  { connectedSource: "Internal", document: "Restricted", narrower: "Restricted", viewer: false },
  { connectedSource: "Internal", document: "Internal", narrower: "Internal", viewer: true },
  { connectedSource: "Internal", document: "Public", narrower: "Internal", viewer: true },
  { connectedSource: "Public", document: "Restricted", narrower: "Restricted", viewer: false },
  { connectedSource: "Public", document: "Internal", narrower: "Internal", viewer: true },
  { connectedSource: "Public", document: "Public", narrower: "Public", viewer: true },
] as const;

const THE_DOCUMENT_NAMES_NO_SENSITIVITY = [
  { connectedSource: "Restricted", document: null, narrower: "Restricted", viewer: false },
  { connectedSource: "Internal", document: null, narrower: "Internal", viewer: true },
  { connectedSource: "Public", document: null, narrower: "Public", viewer: true },
] as const;

const A_WORD_OUTSIDE_THE_SET = [
  { connectedSource: "Secret", document: "Public", narrower: null },
  { connectedSource: "Public", document: "Secret", narrower: null },
  { connectedSource: "Secret", document: null, narrower: null },
  { connectedSource: null, document: "Public", narrower: null },
  { connectedSource: null, document: null, narrower: null },
] as const;

const THE_FOLD_AT_ITS_EDGES = [...THE_DOCUMENT_NAMES_NO_SENSITIVITY, ...A_WORD_OUTSIDE_THE_SET];

const folded = async (
  client: pg.PoolClient,
  pairs: readonly { readonly connectedSource: string | null; readonly document: string | null }[],
): Promise<readonly (string | null)[]> => {
  const answered = await client.query<{ narrower: string | null }>(
    `SELECT narrower_class(pair.a, pair.b) AS narrower
       FROM unnest($1::text[], $2::text[]) WITH ORDINALITY AS pair(a, b, at)
      ORDER BY pair.at`,
    [pairs.map((pair) => pair.connectedSource), pairs.map((pair) => pair.document)],
  );
  return answered.rows.map((row) => row.narrower);
};

describe("the one SQL statement of the sensitivity ranking", () => {
  it("answers the narrower sensitivity for every ranked pair, both orders", async () => {
    await withRollback(db().pool, async (client) => {
      expect(await folded(client, THE_FOLD)).toEqual(THE_FOLD.map((pair) => pair.narrower));
    });
  });

  it("answers the source's sensitivity alone, and null for unknown words", async () => {
    await withRollback(db().pool, async (client) => {
      expect(await folded(client, THE_FOLD_AT_ITS_EDGES)).toEqual(
        THE_FOLD_AT_ITS_EDGES.map((pair) => pair.narrower),
      );
    });
  });

  it("ranks the three sensitivities this package declares and no fourth", () => {
    const ranked = new Set(THE_FOLD.flatMap((pair) => [pair.connectedSource, pair.document]));

    expect([...ranked].toSorted()).toEqual([...SENSITIVITIES].toSorted());
  });

  it("is immutable and pins its search path", async () => {
    const read = await db().pool.query<{ volatile: string; settings: string[] | null }>(
      `SELECT p.provolatile AS volatile, p.proconfig AS settings
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'narrower_class'`,
    );

    expect(read.rows).toEqual([{ volatile: "i", settings: ["search_path=pg_catalog, pg_temp"] }]);
  });

  it("serves the worker, which still cannot read the view", async () => {
    await withRollback(db().pool, async (client) => {
      await twoWorkspaces(client);
      await aPassageUnderAConnectedSource(client, { connectedSourceSensitivity: "Public" });
      await client.query("SET LOCAL ROLE worker_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);

      const served = await client.query<{ narrower: string }>(
        "SELECT narrower_class('Public', 'Internal') AS narrower",
      );
      await refusesEach(client, [
        [THE_VIEW, "worker_rt reading the view the fold answers a sensitivity for"],
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
  it("presents every passage column plus the four visibility terms", async () => {
    const [onThePassage, onTheView] = await Promise.all([
      columnsOf("passage"),
      columnsOf("readable_passage"),
    ]);

    expect({
      missing: onThePassage.filter(
        (column) => !THE_FOUR_TERMS.includes(column) && !onTheView.includes(column),
      ),
      unexpected: onTheView.filter(
        (column) => !THE_FOUR_TERMS.includes(column) && !onThePassage.includes(column),
      ),
      terms: THE_FOUR_TERMS.filter((column) => onTheView.includes(column)),
    }).toEqual({ missing: [], unexpected: [], terms: THE_FOUR_TERMS });
  });

  // From the definition, not a plan: at this suite's row counts a sequential scan is the
  // right plan whether or not the workspace id prunes.
  it("joins the source inner and the document left, by workspace", async () => {
    const read = await db().pool.query<{ definition: string }>(
      `SELECT pg_get_viewdef('"index".readable_passage'::regclass, true) AS definition`,
    );
    const written = (read.rows[0]?.definition ?? "").replaceAll(/\s+/gu, " ");

    expect({
      connectedSource: written.includes(
        "JOIN connected_source b ON b.workspace_id = c.workspace_id AND b.id = c.connected_source_id",
      ),
      document: written.includes(
        "LEFT JOIN source_document d ON d.workspace_id = c.workspace_id AND d.id = c.source_document_id",
      ),
    }).toEqual({ connectedSource: true, document: true });
  });

  it("runs as the invoker, with no security barrier", async () => {
    const read = await db().pool.query<{ options: string[] | null }>(
      `SELECT c.reloptions AS options FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'index' AND c.relname = 'readable_passage'`,
    );

    expect(read.rows).toEqual([{ options: ["security_invoker=true"] }]);
  });
});

describe("what the view reports for a passage, as app_rt", () => {
  it("reports the narrower sensitivity and shows permitted readers the row", async () => {
    await withRollback(db().pool, async (client) => {
      await twoWorkspaces(client);
      const landed: { readonly id: string; readonly expected: string; readonly viewer: boolean }[] =
        [];
      for (const pair of [...THE_FOLD, ...THE_DOCUMENT_NAMES_NO_SENSITIVITY]) {
        const { passage } = await aPassageUnderAConnectedSource(client, {
          connectedSourceSensitivity: pair.connectedSource,
          documentSensitivity: pair.document,
        });
        landed.push({ id: passage.id, expected: pair.narrower, viewer: pair.viewer });
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

  it("carries the source's audience, readable only inside the named group", async () => {
    await withRollback(db().pool, async (client) => {
      await twoWorkspaces(client);
      const held = ulid();
      const unheld = ulid();
      const everyone = await aPassageUnderAConnectedSource(client);
      const toTheGroup = await aPassageUnderAConnectedSource(client, {
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
        inTheGroup: [everyone.passage.id, toTheGroup.passage.id].toSorted(),
        outsideIt: [everyone.passage.id],
        audience: expect.arrayContaining([AUDIENCE_EVERYONE, AUDIENCE_GROUPS]),
      });
    });
  });

  it("carries the publish stamp, hiding an unpublished connected source's passage", async () => {
    await withRollback(db().pool, async (client) => {
      await twoWorkspaces(client);
      await aPassageUnderAConnectedSource(client, { publishedAt: null });
      const published = await aPassageUnderAConnectedSource(client);
      await asAppRt(client, WS_A);

      expect({
        stamps: (await client.query<{ published_at: Date | null }>(THE_VIEW)).rows.filter(
          (row) => row.published_at === null,
        ).length,
        admin: await seenBy(client, ADMIN),
        viewer: await seenBy(client, VIEWER),
      }).toEqual({
        stamps: 1,
        admin: [published.passage.id],
        viewer: [published.passage.id],
      });
    });
  });

  it("reads the source live, so later narrowing shows at once", async () => {
    await withRollback(db().pool, async (client) => {
      await twoWorkspaces(client);
      const { connectedSource, passage } = await aPassageUnderAConnectedSource(client, {
        connectedSourceSensitivity: "Public",
      });
      await asAppRt(client, WS_A);
      const before = await client.query<{ sensitivity: string }>(THE_VIEW);

      await client.query("RESET ROLE");
      await client.query("UPDATE connected_source SET sensitivity = 'Restricted' WHERE id = $1", [
        connectedSource.id,
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
        admin: [passage.id],
      });
    });
  });
});

describe("what the view withholds", () => {
  it("shows a reader scoped to one workspace nothing of another's", async () => {
    await withRollback(db().pool, async (client) => {
      await twoWorkspaces(client);
      const mine = await aPassageUnderAConnectedSource(client, {
        connectedSourceSensitivity: "Public",
      });
      const theirs = await aPassageUnderAConnectedSource(client, {
        workspaceId: WS_B,
        connectedSourceSensitivity: "Public",
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
      }).toEqual({ scoped: [mine.passage.id], theOther: [theirs.passage.id], unscoped: [] });
    });
  });

  it("drops a passage whose source has gone, keeping its neighbour", async () => {
    await withRollback(db().pool, async (client) => {
      await twoWorkspaces(client);
      // A passage naming a document cascades away with the connected source; one naming none outlives
      // it, and the inner join is what withholds it.
      const orphaned = await aPassageUnderAConnectedSource(client, {
        connectedSourceSensitivity: "Public",
        withoutADocument: true,
      });
      const neighbour = await aPassageUnderAConnectedSource(client, {
        connectedSourceSensitivity: "Public",
      });
      await client.query("DELETE FROM connected_source WHERE id = $1", [
        orphaned.connectedSource.id,
      ]);
      const standing = await client.query('SELECT id FROM "index".passage WHERE id = $1', [
        orphaned.passage.id,
      ]);
      await asAppRt(client, WS_A);

      expect({
        passageRowStands: standing.rowCount,
        throughTheView: (await client.query<{ id: string }>(THE_VIEW)).rows.map((row) => row.id),
        readable: await seenBy(client, ADMIN),
      }).toEqual({
        passageRowStands: 1,
        throughTheView: [neighbour.passage.id],
        readable: [neighbour.passage.id],
      });
    });
  });

  it("keeps a passage naming no document, at its source's sensitivity", async () => {
    await withRollback(db().pool, async (client) => {
      await twoWorkspaces(client);
      const { passage } = await aPassageUnderAConnectedSource(client, {
        connectedSourceSensitivity: "Public",
        withoutADocument: true,
      });
      await asAppRt(client, WS_A);

      const reported = await client.query<{ id: string; sensitivity: string }>(THE_VIEW);

      expect(reported.rows).toEqual(
        [{ id: passage.id, sensitivity: "Public" }].map(publishedToEveryone),
      );
      expect(await seenBy(client, VIEWER)).toEqual([passage.id]);
    });
  });
});

describe("who may read the view", () => {
  it("is selected by app_rt, and worker_rt holds nothing on it", async () => {
    await withRollback(db().pool, async (client) => {
      await twoWorkspaces(client);
      const { passage } = await aPassageUnderAConnectedSource(client, {
        connectedSourceSensitivity: "Public",
      });

      const forTheApp = await privilegesHeld(client, "app_rt", '"index".readable_passage');
      const forTheWorker = await privilegesHeld(client, "worker_rt", '"index".readable_passage');

      await client.query("SET LOCAL ROLE worker_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
      await refusesEach(client, [
        [THE_VIEW, "worker_rt selecting the view the api reads a passage through"],
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
        served: [passage.id],
      });
    });
  });
});

describe("a partition attached after the view was made", () => {
  it("reads through it as through the first partition", async () => {
    await withRollback(db().pool, async (client) => {
      await twoWorkspaces(client);
      const first = await aPassageUnderAConnectedSource(client, {
        connectedSourceSensitivity: "Public",
      });
      await asAppRt(client, WS_A);
      const before = await seenBy(client, VIEWER);

      await client.query("RESET ROLE");
      const later = await aPassageUnderAConnectedSource(client, {
        workspaceId: WS_B,
        connectedSourceSensitivity: "Public",
      });
      await asAppRt(client, WS_B);

      expect({ before, after: await seenBy(client, VIEWER) }).toEqual({
        before: [first.passage.id],
        after: [later.passage.id],
      });
    });
  });
});
