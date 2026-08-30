import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { migrationsFolder } from "../src/index.ts";

describe("the migrations this package hands the app", () => {
  it("resolves to a folder the migrator can read", () => {
    // `app/src/migrate.ts` passes this path straight to Drizzle's migrator, and the
    // failure it gives for a missing folder appears at deploy time, in the `migrate`
    // one-shot, not here — so the folder's existence is checked where it is cheap.
    expect(existsSync(migrationsFolder)).toBe(true);
    expect(existsSync(join(migrationsFolder, "meta", "_journal.json"))).toBe(true);
  });
});
