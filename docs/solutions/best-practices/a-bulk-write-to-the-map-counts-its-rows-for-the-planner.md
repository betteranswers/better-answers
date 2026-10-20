---
title: "A bulk write to the map counts its rows for the planner, or the next walk times out"
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

# A bulk write to the map counts its rows for the planner, or the next walk times out

## Context

The map walk (`walkStatement` in `packages/core/src/store/map/index.ts`) is a recursive CTE that hops `map_edge` into `map_node` by `workspace_id` and `uid`, under a two-second `statement_timeout`. The planner picks its join order from the tables' statistics. A generation the worker has just rebuilt, or a bundle the api has just imported, is a bulk write that autovacuum has not yet counted. In that window the planner estimates one row for the workspace's nodes and nested-loops every live node against every step of the walk.

BA-151 measured a forty-entry walk over a two-thousand-node map with six links each, on the same rows before and after `ANALYZE`: 40 to 51 s and 32 million buffer hits before, with the planner estimating one node row against the 2,000 it read on each of five iterations, and 25 to 50 ms and 867 buffer hits after. An `ask` in that window answers from its entry points alone and reads "map unavailable since". Core's tests did not show it because `packages/core/test/asking.ts` runs `ANALYZE map_node, map_edge` before every ask.

## Guidance

A writer that lands many map rows at once calls `analyse_map()` after its last write. Migration 0088 creates the function. It is a `SECURITY DEFINER` function because `ANALYZE` takes the table's owner or `MAINTAIN`, which neither runtime role holds. Row writes never block it. It waits on another count, which holds its lock to its own commit, on an autovacuum of either table, which cancels itself after a second when something waits on it, or on an exclusive lock a migration has queued ahead of it. The function is in the roster in `packages/schema/src/definer-reach.ts`, which the roles-surface test holds against the catalogue.

The two bulk writers call it:

- the worker's rebuild, `apps/worker/src/better_answers_worker/rebuild.py`, right after it flips `live_gen`, inside the rebuild's transaction, so a count that fails rolls the generation back and the job is retried;
- the api's import, `runImport` in `packages/core/src/concepts/index.ts`, through the map store's `analyseMap`, once landing has ended, whether it ran to the end or stopped at a file, and a count that fails is the import's error.

The function waits at most 5 s for a lock (`lock_timeout`), as `create_question_content_partition` does.

An ordinary edit's delta (`writeConceptDelta`) does not call it. The migration also sets `autovacuum_analyze_scale_factor = 0.01` on both tables, so autovacuum counts the rows once a hundredth of a table has changed, where the default waits for a tenth. That floor is for the rows no bulk writer counts, such as a new tenant's map written edit by edit. It is not a backstop for a missed call: at 200,000 node rows, one tenant's 2,000-node rebuild no longer reaches it.

Test a new writer the way the two existing cases do. Switch autovacuum off on both tables first, or the case races autovacuum:

- `packages/core/test/analysed-map.test.ts` rebuilds a map of twenty hubs with 250 spokes each in a real worker and asks with `askedAsIs`, which analyses nothing. It answers with the map live and a walked concept. With the call line removed from `rebuild.py` it answers "unavailable since". The shape is the cheapest one with margin: the un-analysed plan's cost is the nodes times the edges walked, and twenty hubs walk 5,000 edges over 5,020 nodes in one hop, where a ring of two thousand nodes with six links each measured only 2.8 s against the 2 s timeout from the ask's twenty entries.
- `packages/core/test/import-bundle.test.ts`, "counts the map's rows for the planner once landed", reads `pg_class.reltuples` against the rows the import landed.

Never seed the map by SQL and call the function from the test itself. That proves the function works, which `packages/schema/test/analysed-map.test.ts` already holds, and nothing about the writer.

## Examples

`packages/schema/migrations/0088_the-analysed-map.sql` is the function and the floor. The measurement is in BA-151's pull request.
