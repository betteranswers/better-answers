---
title: "A boundary schema is generated from its table and a refinement only narrows it"
date: 2026-09-01
module: packages/schema
problem_type: architecture_pattern
component: stores
severity: medium
applies_when:
  - "Adding a table, or a column to one, in packages/schema"
  - "Validating a row or an input against a table's shape with zod"
  - "Branding an id or narrowing the values a column accepts"
  - "Adding a customType or jsonb column"
tags:
  - adr-0028
  - boundary-schema
  - refinement
  - drizzle-zod
  - zod
  - parity-test
---

# A boundary schema is generated from its table and a refinement only narrows it

## The decision

Every zod schema over a table is generated from that table by `drizzle-zod`, in `packages/schema` and nowhere else. The package exports a boundary schema for every table it owns, in three shapes: select, insert and update. They sit in one registry, `boundarySchemas`, in `packages/schema/src/boundary-schemas.ts`.

- A refinement narrows one column. It is written in the second argument of the generating call, one entry per column, as a callback: `{ workspaceId: (schema) => schema.regex(ULID).brand<"WorkspaceId">() }`. It is never a plain schema.
- A refinement only narrows, and a parity test proves it.
- A boundary imports its schema from `@better-answers/schema` and shapes it: `.pick()`, `.omit()`, `.partial()`, and `.extend()` with fields that are not columns. It never writes a `z.object` naming a table's columns.
- `drizzle-zod` is imported only by `packages/schema/src/drizzle-zod.ts`. A `no-restricted-imports` ban in `.oxlintrc.json` refuses it everywhere else.
- The boundary schema, not the Drizzle table, is the source of application-level types. A brand survives `z.infer` and reaches the tRPC router, the OpenAPI document and the MCP tool schemas.

A `customType` column, such as `index.passage`'s vector, is the one exception. It takes a plain schema, because a callback there compiles and then throws at module evaluation. That plain schema is built and tested per shape: select and insert take it as it is, and update takes it wrapped in `.optional()`. Each shape has its own test in `packages/schema/test/boundary-schemas.test.ts`.

The parity test makes five assertions over the registry, against a real Postgres. Each compares an entry with the unrefined generation of the same table.

1. Every exported table has a boundary.
2. The key sets agree, for each of the three shapes.
3. Optionality and nullability agree per key at runtime. The `customType` column is exempt; its per-shape tests cover it.
4. The fixture rows the refined insert schema accepts are inserted inside a rolled-back transaction, and the table must accept every one.
5. Each boundary schema's inferred type is pinned with `Expect<Equal<…>>`.

## Why

- A column and a hand-written zod schema over it would drift in silence.
- A plain-schema refinement replaces the column wholesale. It drops nullability and optionality at runtime, so a select schema rejects a row Postgres legitimately returned. The callback keeps both, and turns a column's type change into a type error.
- The types never check a refinement against its column. `z.number()` over a `text` column compiles, and `z.infer` follows the refinement. A dropped column fails `check`; a retyped column or a widened `pgEnum` fails nothing. Assertion 4 catches widening and assertion 5 catches a retype, and neither can do the other's job.
- A plain schema reused across shapes loses the update schema's `.optional()`. The passage update schema demanded the embedding on every update until review caught it.
- drizzle-orm v1 moves the package to a `drizzle-orm/zod` export, so one importing module makes that upgrade one edit.

## Rejected

- Hand-written zod schemas beside the tables: the drift this decision exists to close.
- Generated schemas with no refinements, narrowed at each boundary: every caller re-derives the brand, the trim and the ULID check, differently.
- The plain-schema form throughout: it drops nullability at runtime. Kept for `customType` columns only.
- A type-level drift check alone: blind to widening.
- A runtime parity check alone: blind to a retyped column.
- `drizzle-kit`'s snapshot diff: it watches the migration, not the boundary, and cannot model `index.passage`'s partitioning.
- `createSchemaFactory({ coerce })`: a boundary parses and never coerces.

## History

The full record, with its one amendment (T-025): `docs/archive/adr/0028-boundary-schemas-generated-from-tables.md`.
