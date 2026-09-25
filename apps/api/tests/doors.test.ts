import { describe, expect, it } from "vitest";

import { closeDoors, openDoors, POSTGRES_POOL_MAX } from "../src/doors.ts";
import { appForSuite } from "./suite-app.ts";

const UNUSED_DATABASE = "postgresql://unused@127.0.0.1:1/unused";

const UNREACHABLE_OBJECT_STORE = {
  endpoint: "http://127.0.0.1:1",
  region: "garage",
  bucket: "better-answers",
  accessKeyId: "key",
  secretAccessKey: "secret",
} as const;

describe("the api's one composition root", () => {
  const app = appForSuite();

  it("opens a pool sized by one constant operators can read", async () => {
    const doors = openDoors({ database: UNUSED_DATABASE });

    expect(doors.postgres.pool.options.max).toBe(POSTGRES_POOL_MAX);
    expect(POSTGRES_POOL_MAX).toBe(10);
    await closeDoors(doors);
  });

  it("opens the configured bundles' root and object store", () => {
    const doors = openDoors({
      database: app().database.pool,
      gitStoreDir: app().gitStoreDir,
      objectStore: UNREACHABLE_OBJECT_STORE,
    });

    expect(doors.git).toEqual({ ok: true, value: { root: app().gitStoreDir } });
    expect(doors.objects?.ok === true && doors.objects.value.bucket).toBe("better-answers");
  });

  it("leaves an unconfigured store absent rather than guessing one", () => {
    const doors = openDoors({ database: app().database.pool });

    expect(doors.git).toBeUndefined();
    expect(doors.objects).toBeUndefined();
  });

  it("carries a missing repositories' root's refusal rather than stopping", () => {
    const missing = `${app().gitStoreDir}/does-not-exist`;

    const doors = openDoors({ database: app().database.pool, gitStoreDir: missing });

    expect(doors.git).toEqual({
      ok: false,
      error: `the repositories' root is no-such-root (GIT_STORE_DIR=${missing})`,
    });
    expect(doors.postgres.pool).toBe(app().database.pool);
  });

  it("carries a bucketless object store's refusal the same way", () => {
    const doors = openDoors({
      database: app().database.pool,
      objectStore: { ...UNREACHABLE_OBJECT_STORE, bucket: "" },
    });

    expect(doors.objects).toEqual({
      ok: false,
      error: "the object store is no-bucket (S3_ENDPOINT=http://127.0.0.1:1)",
    });
  });

  it("hands every process the same Clock, not the wall's", () => {
    const at = new Date("2026-09-22T09:00:00.000Z");

    const doors = openDoors({ database: app().database.pool, clock: { now: () => at } });

    expect(doors.clock.now()).toEqual(at);
  });
});
