import { describe, expect, it } from "vitest";

import { rootsOf } from "@better-answers/schema/testing/roots";

import { run, warmPostgresModule } from "./child.ts";
import { DURABILITY_OFF } from "./server.ts";

const { workspaceRoot } = rootsOf(import.meta.url);

describe("the warm harness", () => {
  it("starts its own database when no warm cluster exists", async () => {
    const script = [
      `import { openMigratedPostgres } from ${JSON.stringify(warmPostgresModule)};`,
      "const db = await openMigratedPostgres();",
      "const footing = await db.runtimePool.query('SELECT current_user AS role');",
      "const policies = await db.pool.query('SELECT policyname FROM pg_policies WHERE tablename = $1', ['model_choice']);",
      "const fsync = await db.pool.query('SHOW fsync');",
      "const synchronousCommit = await db.pool.query('SHOW synchronous_commit');",
      "const fullPageWrites = await db.pool.query('SHOW full_page_writes');",
      "const answer = { role: footing.rows[0].role, isolationPolicy: policies.rows[0].policyname, durability: { fsync: fsync.rows[0].fsync, synchronous_commit: synchronousCommit.rows[0].synchronous_commit, full_page_writes: fullPageWrites.rows[0].full_page_writes } };",
      "process.stdout.write(JSON.stringify(answer));",
      "await db.stop();",
    ].join("\n");

    const cold = await run(process.execPath, ["--input-type=module", "--eval", script], {
      cwd: workspaceRoot,
    });

    expect(JSON.parse(cold.stdout)).toEqual({
      role: "app_rt",
      isolationPolicy: "model_choice_workspace_isolation",
      durability: DURABILITY_OFF,
    });
  }, 300_000);
});
