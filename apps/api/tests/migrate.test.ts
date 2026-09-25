import { spawnSync } from "node:child_process";
import path from "node:path";

import { CONTRACT_DIGEST } from "@better-answers/schema";
import { matchIsLeakproof, UNMARK_THE_MATCH } from "@better-answers/schema/testing/probes";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startTestDatabase, type TestDatabase } from "./postgres.ts";

const apiRoot = path.resolve(import.meta.dirname, "..");

let database: TestDatabase;

beforeAll(async () => {
  database = await startTestDatabase();
});

afterAll(async () => {
  await database.stop();
});

const migrating = (): { readonly status: number | null; readonly said: string } => {
  const finished = spawnSync(process.execPath, ["src/migrate.ts"], {
    cwd: apiRoot,
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: database.connectionUri },
  });
  return { status: finished.status, said: `${finished.stdout}${finished.stderr}` };
};

const stampedDigests = async (): Promise<readonly { readonly digest: string }[]> => {
  const read = await database.superuser.query<{ digest: string }>(
    "SELECT digest FROM contract_stamp",
  );
  return read.rows;
};

describe("migrate", () => {
  it("stamps the image's contract for the worker to compare", async () => {
    await database.superuser.query("DELETE FROM contract_stamp");

    const first = migrating();

    expect({ status: first.status, said: first.said }).toEqual({ status: 0, said: first.said });
    expect(await stampedDigests()).toEqual([{ digest: CONTRACT_DIGEST }]);
  });

  it("rewrites the one row on the next deploy, adding none", async () => {
    await database.superuser.query("UPDATE contract_stamp SET digest = $1", [
      "a-contract-an-older-image-carried",
    ]);

    expect(migrating().status).toBe(0);

    expect(await stampedDigests()).toEqual([{ digest: CONTRACT_DIGEST }]);
  });

  it("re-marks the full-text match leakproof after a restore dropped it", async () => {
    await database.superuser.query(UNMARK_THE_MATCH);
    const restored = await matchIsLeakproof(database.superuser);

    expect(migrating().status).toBe(0);

    expect({ restored, migrated: await matchIsLeakproof(database.superuser) }).toEqual({
      restored: false,
      migrated: true,
    });
  });
});
