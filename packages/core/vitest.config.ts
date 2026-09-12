import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // One container and one migrated template for the whole run, started before the first
    // file and stopped only when the Vitest instance closes. The schema package's own export
    // rather than a copy of it, so the setup this package registers is the setup every other
    // workspace registers.
    globalSetup: ["@better-answers/schema/testing/warm-postgres"],
    // The import-direction test shells out to oxlint over a temporary tree.
    testTimeout: 60_000,
    // A runaway guard, not a budget: it decides how long a wedged cluster hangs before Vitest
    // calls it. The template copy it governs is milliseconds; nothing healthy approaches this.
    hookTimeout: 120_000,
    // Vitest's forks pool otherwise scales to the host's `availableParallelism` of 14,
    // while every container a run starts — the warm Postgres, up to four Garages, the
    // worker the two rebuild suites spawn — lives inside a Docker VM capped at 6 CPUs. The
    // run therefore over-subscribes the scarce resource by more than two to one. The cap is
    // the VM's CPU count, and it is the number the readings below chose rather than the one
    // that reads well.
    //
    // `pnpm --filter @better-answers/core run check`, timed end to end on a quiet machine
    // (nothing else of the build loop running, no other container up) — Apple M4 Pro, 14
    // cores, 24 GiB; Docker VM 6 CPUs, 6144 MiB — 12/09/2026. Every run 34 files and 737
    // tests green, no test reaching the 60 s ceiling:
    //
    //   no cap, production durability   5m46.2s   summed test time 2594s
    //   durability off, no cap          5m40.3s                    2608s
    //   durability off, maxWorkers 4    5m43.9s                    1324s
    //   durability off, maxWorkers 6    5m36.4s                    1928s
    //
    // Ten seconds of a 346-second run is the honest size of the effect here, and that is
    // the point rather than a disappointment: a solo run on a quiet machine is not what the
    // cap is for. Where the contention shows is the summed test time, which falls from
    // 2594s to 1928s at this cap — and to 1324s at the tighter one — while wall time moves
    // by seconds. What the cap removes is the per-test cost of 14 forks fighting over 6
    // CPUs, and that is the cost which compounds when the root check runs four workspaces
    // at once, which is the condition T-140 was cut for. 4 is rejected because it pays more
    // wall time for contention already bounded at 6.
    maxWorkers: 6,
  },
});
