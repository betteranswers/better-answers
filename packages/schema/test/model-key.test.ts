import type pg from "pg";
import { describe, expect, it } from "vitest";

import { boundarySchemas, MODEL_NAME } from "../src/index.ts";
import { testData } from "./factory.ts";
import { withRollback } from "./harness.ts";
import { postgresForSuite, privilegesHeld, refusalOf } from "./probes.ts";
import { A_MODEL_KEY } from "./rls-probes.ts";

const db = postgresForSuite();

const WS_A = "01J6AAAAAAAAAAAAAAAAAAAAAA";
const WS_B = "01J6BBBBBBBBBBBBBBBBBBBBBB";

const A_FRAME = new Uint8Array(40).fill(9);

const aKeyInEach = async (client: pg.PoolClient): Promise<void> => {
  const seed = testData(client);
  await seed.workspace({ id: WS_A, name: "A" });
  await seed.workspace({ id: WS_B, name: "B" });
  await seed.modelKey({ workspaceId: WS_A });
  await seed.modelKey({ workspaceId: WS_B });
};

const asTheApiIn = async (client: pg.PoolClient, workspaceId: string): Promise<void> => {
  await client.query("SET LOCAL ROLE app_rt");
  await client.query("SELECT set_config('app.workspace_id', $1, true)", [workspaceId]);
};

const workspacesRead = async (client: pg.PoolClient): Promise<readonly string[]> => {
  const read = await client.query<{ workspace_id: string }>(
    "SELECT workspace_id FROM model_key ORDER BY workspace_id",
  );
  return read.rows.map((row) => row.workspace_id);
};

describe("a workspace's model key", () => {
  it("is read by the api inside its workspace alone", async () => {
    await withRollback(db().pool, async (client) => {
      await aKeyInEach(client);

      await asTheApiIn(client, WS_A);

      expect(await workspacesRead(client)).toEqual([WS_A]);
    });
  });

  it("is read by nobody with no workspace in scope", async () => {
    await withRollback(db().pool, async (client) => {
      await aKeyInEach(client);

      await asTheApiIn(client, "");

      expect(await workspacesRead(client)).toEqual([]);
    });
  });

  it("refuses the api a key written into another workspace", async () => {
    await withRollback(db().pool, async (client) => {
      await aKeyInEach(client);
      await asTheApiIn(client, WS_A);

      await expect(client.query(A_MODEL_KEY, [WS_B, "mistral", A_FRAME])).rejects.toThrow(
        /row-level security/,
      );
    });
  });

  it("gives the worker no privilege at all", async () => {
    await withRollback(db().pool, async (client) => {
      const held = await privilegesHeld(client, "worker_rt", "model_key");

      expect(Object.values(held)).toEqual(Object.values(held).map(() => false));
    });
  });

  it("lets the api set and replace, never remove", async () => {
    await withRollback(db().pool, async (client) => {
      const held = await privilegesHeld(client, "app_rt", "model_key");

      expect(held).toMatchObject({ SELECT: true, INSERT: true, UPDATE: true, DELETE: false });
    });
  });

  it("holds one key for each workspace and model provider", async () => {
    await withRollback(db().pool, async (client) => {
      await aKeyInEach(client);

      expect({
        again: await refusalOf(client, () =>
          client.query(A_MODEL_KEY, [WS_A, "anthropic", A_FRAME]),
        ),
        another: await refusalOf(client, () =>
          client.query(A_MODEL_KEY, [WS_A, "mistral", A_FRAME]),
        ),
      }).toEqual({ again: "model_key_workspace_id_provider_pk", another: "admitted" });
    });
  });

  it("refuses a model provider outside the closed set", async () => {
    await withRollback(db().pool, async (client) => {
      await aKeyInEach(client);

      expect(
        await refusalOf(client, () => client.query(A_MODEL_KEY, [WS_A, "openai", A_FRAME])),
      ).toBe("model_key_provider_check");
    });
  });

  it("refuses a key for a workspace that does not exist", async () => {
    await withRollback(db().pool, async (client) => {
      const nowhere = "01J6CCCCCCCCCCCCCCCCCCCCCC";

      expect(
        await refusalOf(client, () => client.query(A_MODEL_KEY, [nowhere, "anthropic", A_FRAME])),
      ).toBe("model_key_workspace_id_workspace_id_fk");
    });
  });
});

describe("what a model key's row holds", () => {
  it("holds the key sealed, in no readable column", () => {
    expect(Object.keys(boundarySchemas.modelKey.select.shape).toSorted()).toEqual([
      "provider",
      "sealed",
      "workspaceId",
    ]);
  });
});

describe("a model's name", () => {
  const KEY_SHAPED = {
    anthropic: `sk-ant-api03-${"Ab3_".repeat(23)}-AA`,
    mistral: "Zq7Lm2Xc".repeat(4),
    cloudflare: "Ab3Cd_Ef5-".repeat(4),
  };

  it.each(Object.entries(KEY_SHAPED))("refuses a key in %s's shape", (_provider, key) => {
    expect(MODEL_NAME.test(key)).toBe(false);
  });

  it.each(["claude-sonnet-4-5", "mistral-large-2411"])("takes %s", (name) => {
    expect(MODEL_NAME.test(name)).toBe(true);
  });
});
