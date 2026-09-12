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
    // worker the two rebuild suites spawn — lives inside a Docker VM of 10 CPUs and
    // 15.6 GiB. The run therefore over-subscribes the scarce resource, and the cap is what
    // stops it.
    //
    // The cap stays 6 now that the VM is 10, which is the one place this file no longer
    // says "the VM's CPU count". A fork is not the only thing that needs a CPU in there:
    // the warm Postgres every test in the run shares, the Garages, and the worker the
    // rebuild suites spawn all live in the same VM, and they are what the forks spend their
    // time waiting on. Raising the pool with the VM was measured rather than assumed, and
    // the readings below say it buys nothing and costs contention.
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
    //
    // The VM then grew to 10 CPUs and 15.6 GiB, so 6 stopped being its CPU count and 8 was
    // proposed in its place. Root `pnpm check` from the H2 worktree, taken as a control and
    // a treatment back to back under the same synthetic load — two loops of this package's
    // reconciler, rebuild-equivalence and graph-budget suites, each pinned to 6 workers in
    // both runs so the edit moved the run under measurement and not the load it was measured
    // against — Apple M4 Pro, 14 cores, 24 GiB; Docker VM 10 CPUs, 15.6 GiB — 12/09/2026:
    //
    //   maxWorkers 6   root wall 1301s   this package 583.91s wall, summed 3212s, 2 timeouts
    //   maxWorkers 8   root wall 1059s   this package 582.98s wall, summed 3866s, 4 timeouts
    //
    // The root wall time favours 8 and that number is not the cap's: 202s of the 242s gap is
    // the worker tier's pytest, 360.55s against 158.88s on a cache the first run warmed, and
    // no Python test runs in a Vitest fork. On what the cap does govern, 8 buys nothing —
    // this package's wall time moves by under a second, `apps/api`'s rises from 155.19s to
    // 162.59s — and costs the thing the readings above were taken to measure: summed test
    // time rises 20%, from 3212s to 3866s, which is the per-test contention cost in the
    // direction those readings say a looser cap moves it. The timeouts follow it, 2 to 4,
    // every one of them a 60s or 90s ceiling under load rather than a wrong answer. So 6
    // stands on the VM of 10, now as a measured number rather than as the VM's own count.
    //
    // Both runs of that pair were red, which is the load's doing and not the tree's: the
    // load loops run this package's slowest suites against the same VM as the run under
    // measurement, and the case T-140 sized at 90s for root-check contention alone reads
    // 90014ms with two more copies of itself alongside. A third run at this cap with the
    // load stopped says so — green end to end, 651s, this package 35 files and 741 tests in
    // 422.87s wall on 2326s summed. That is also the number to compare against H1's 851/840/
    // 834s at `1d74187`, which were taken on this same host with the VM at 6 CPUs and
    // 6144 MiB: the VM's growth is where the wall time went, and the cap is not what moved.
    maxWorkers: 6,
  },
});
