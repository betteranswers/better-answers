---
title: "A bulk write to the map analyses it for the planner, or the next walk times out"
date: 2026-10-20
category: best-practices
module: packages/core
problem_type: best_practice
component: stores
severity: high
applies_when:
  - "A change adds a writer that inserts many map_node or map_edge rows in one run, beside the worker's rebuild and the api's import-bundle"
  - "An ask answers 'map unavailable since' right after a rebuild or an import, with the walk cancelled by its statement_timeout"
symptoms:
  - "A walk over a map Postgres has not analysed takes a minute, where the same walk takes a few milliseconds once the tables are analysed"
  - "EXPLAIN shows the planner estimating one row for the workspace's nodes and nested-looping every live node against every step"
root_cause: missing_tooling
resolution_type: migration
retire_when: "Postgres plans the recursive walk without statistics, or the walk no longer joins map_node by workspace and uid. Check by rebuilding a two-thousand-node map with autovacuum off and timing the forty-entry walk before any ANALYZE"
tags: [map, walk, analyze, statistics, autovacuum, security-definer, rebuild, import-bundle, ask]
---

# A bulk write to the map analyses it for the planner, or the next walk times out

## Context

The map walk (`walkStatement` in `packages/core/src/store/map/walk.ts`) is a recursive CTE that hops `map_edge` into `map_node` by `workspace_id` and `uid`, under a two-second `statement_timeout`. The planner picks its join order from the tables' statistics. A generation the worker has just rebuilt, or a bundle the api has just imported, is a bulk write that autovacuum has not yet analysed. In that window the planner estimates one row for the workspace's nodes and nested-loops every live node against every step of the walk.

BA-151 measured a forty-entry walk over a two-thousand-node map with six links each, on the same rows before and after `ANALYZE`: 40 to 51 s and 32 million buffer hits before, with the planner estimating one node row against the 2,000 it read on each of five iterations, and 25 to 50 ms and 867 buffer hits after. An `ask` in that window answers from its entry points alone and reads "map unavailable since". Core's tests did not show it because `asked` in `packages/core/test/answering/asking.ts` runs `ANALYZE map_node, map_edge` before it asks. `askedAsIs` analyses nothing.

## Guidance

A writer that lands many map rows at once calls `analyse_map()` after its write commits. Migration 0088 creates the function. It is a `SECURITY DEFINER` function because `ANALYZE` takes the table's owner or `MAINTAIN`, which neither runtime role holds. Row writes never block it. It waits on another analyse, which holds its lock to its own commit, on an autovacuum of either table, which cancels itself after a second when something waits on it, or on an exclusive lock a migration has queued ahead of it. It waits at most 5 s (`lock_timeout`), as `create_question_content_partition` does. The function is in the roster in `packages/schema/src/definer-reach.ts`, which the roles-surface test holds against the catalogue.

The analyse is an optimisation, so a failed analyse never fails or undoes the write it follows. The writer logs the failure as a warning and keeps its outcome. The autovacuum floor below analyses the map later.

The two bulk writers call it:

- The worker's rebuild. `full_rebuild` in `apps/worker/src/better_answers_worker/kinds.py` calls `analyse_map` from `rebuild.py` after the rebuild's transaction commits, so `live_gen` has already flipped. A failed analyse logs "the map was left unanalysed" with its SQLSTATE, and the job still completes.
- The api's import. `runImport` in `packages/core/src/concepts/index.ts` calls the map store's `analyseMap` once landing has ended, whether it ran to the end or stopped at a file. A failed analyse goes to the import's `log` door as a warning. The import still reports what it landed, or the refusal it stopped with.

An ordinary edit's delta (`writeConceptDelta`) does not call it. The migration also sets `autovacuum_analyze_scale_factor = 0.01` on both tables, so autovacuum analyses a table once a hundredth of it has changed, where the default waits for a tenth. That floor is for the rows no bulk writer analyses, such as a new tenant's map written edit by edit, and for a failed analyse. It is not a backstop for a missed call: at 200,000 node rows, one tenant's 2,000-node rebuild no longer reaches it.

Test a new writer the way the existing cases do. Switch autovacuum off on both tables first, or the case races autovacuum:

- `packages/core/test/budgets/analysed-map.budget.ts` rebuilds a map of twenty hubs with 250 spokes each in a real worker and asks with `askedAsIs`. It answers with the map live and a walked concept. With the call removed from `kinds.py` it answers "unavailable since". It runs nightly in `budgets.yml`, not in `check`. There it guards that an ask over a worker-analysed map of 5,020 nodes stays inside the 2 s walk timeout. The two `reltuples` cases below run in `check` and guard that a bulk write analyses the map. The shape is the cheapest one with margin: the un-analysed plan's cost is the nodes times the edges walked, and twenty hubs walk 5,000 edges over 5,020 nodes in one hop, where a ring of two thousand nodes with six links each measured only 2.8 s against the 2 s timeout from the ask's twenty entries.
- `packages/core/test/concepts/import/import-bundle.test.ts`, "analyses the map for the planner once landed", compares `pg_class.reltuples` for both map tables with every row the tables hold.
- `apps/worker/tests/test_work_loop.py`, `test_a_rebuild_analyses_the_map_for_the_planner`, runs a full-rebuild job through `loop.tick` and reads `pg_class.reltuples`.

Test the failure too. A second connection holds `SHARE UPDATE EXCLUSIVE` on `map_node`, which blocks the analyse and none of the row writes, so the analyse ends at its lock timeout. `import-bundle.test.ts` has "reports a landed import when the analyse fails" and "keeps the stopped refusal when the analyse fails too". `test_work_loop.py` has `test_a_rebuild_whose_analyse_fails_still_goes_live`.

Never seed the map by SQL and call the function from the test itself. That proves the function works, which `packages/schema/test/knowledge/analysed-map.test.ts` already holds, and nothing about the writer.

## Examples

`packages/schema/migrations/0088_the-analysed-map.sql` is the function and the floor. The measurement is in BA-151's pull request.
