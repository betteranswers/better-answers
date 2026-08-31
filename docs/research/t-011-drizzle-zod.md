---
date: 2026-08-31
question: >-
  What does drizzle-zod give us on drizzle-orm 0.45.2 / zod 4.5.4, and what
  happens to a per-column refinement when the column beneath it drifts?
sources: 9 primary (npm registry API, the published drizzle-zod 0.8.3 tarball,
  the drizzle-orm-docs repository, the drizzle-orm changelogs directory, and a
  local typecheck/runtime probe built against the exact pinned versions)
---

# drizzle-zod — findings for T-011

## Verdict in five lines

1. **Pin `drizzle-zod` at `0.8.3`.** It is the current `latest`, its peers are `zod: ^3.25.0 || ^4.0.0` and `drizzle-orm: >=0.36.0`, so `zod 4.5.4` and `drizzle-orm 0.45.2` both satisfy it. There is **no peer-range mismatch** — verified by installing the exact triple.
2. `createSelectSchema` is total, `createInsertSchema` drops generated-always columns and makes defaulted ones optional, `createUpdateSchema` is `createInsertSchema` with *every* field optional (including the primary key).
3. **Refinement drift is caught only partially.** A refinement naming a **dropped** column is a compile error in all three functions (with a much worse message for `createSelectSchema`). A refinement whose **type contradicts** the column is *silently accepted* when it is a plain schema, and is caught only when the callback form calls a method the new base schema lacks.
4. **Branded types round-trip cleanly.** `z.infer` carries `string & z.$brand<'WorkspaceId'>` straight through. This is the strongest reason to use refinements here.
5. **`customType` columns are the sharp edge**: the types claim `z.ZodString` for `customType<{ data: string }>`, but the runtime emits `z.any()`. A callback refinement on such a column **throws a `TypeError` at module load**.

---

## How this was established

Two kinds of evidence are used below, and they are labelled:

- **Documented** — read from a first-party document, cited by URL.
- **Measured** — observed in a throwaway project at `/tmp/dztest` (outside this
  repo; nothing here was installed or modified) containing exactly
  `drizzle-orm@0.45.2`, `drizzle-zod@0.8.3`, `zod@4.5.4`, `typescript@7.0.2`,
  `@types/node@24.13.3` — the versions this repo pins. Type-level claims are
  `Expect<Equal<…>>` assertions that compile clean under `tsc --strict`;
  runtime claims are printed constructor names and `safeParse` results.

Where the two disagree, that disagreement is itself the finding (§4).

---

## 1. Versions, and whether this repo's pins line up

### The version to pin

**`drizzle-zod@0.8.3`**, read on 2026-08-31 from
`https://registry.npmjs.org/drizzle-zod` (the packument; `dist-tags.latest`
is `0.8.3`, published `2025-08-06`).

Its manifest, from the same document:

```json
"peerDependencies": { "drizzle-orm": ">=0.36.0", "zod": "^3.25.0 || ^4.0.0" }
```

### The compatibility answer, plainly

| This repo pins | Latest on npm (2026-08-31) | drizzle-zod 0.8.3 peer range | Satisfied? |
| --- | --- | --- | --- |
| `zod` 4.5.4 | 4.5.4 (published 2026-08-29) | `^3.25.0 \|\| ^4.0.0` | yes |
| `drizzle-orm` 0.45.2 | 0.45.2 (published 2026-03-27) | `>=0.36.0` | yes |
| `drizzle-kit` 0.31.10 | 0.31.10 (published 2026-03-17) | *(not a drizzle-zod peer at all)* | n/a |

Versions and publish dates read from `https://registry.npmjs.org/drizzle-zod`,
`https://registry.npmjs.org/drizzle-orm`, `https://registry.npmjs.org/drizzle-kit`
and `https://registry.npmjs.org/zod` on 2026-08-31. `drizzle-kit` is a CLI; it is
not in drizzle-zod's peer set, so it cannot conflict.

**Measured:** `npm install drizzle-orm@0.45.2 drizzle-zod@0.8.3 zod@4.5.4`
resolves with zero peer warnings, and `npm ls` shows drizzle-zod's peers deduped
onto the top-level `drizzle-orm@0.45.2` and `zod@4.5.4`. No `--legacy-peer-deps`
and no pnpm `peerDependencyRules` entry is needed.

### Which release first supported zod v4

There are **two** answers and the distinction matters.

- **`0.8.0`** (2025-05-20) is the release that adopted the zod v4 *API*. Its
  changelog reads, in full: *"Support for Zod v4: Starting with this release,
  `drizzle-zod` now requires Zod v3.25 or later"*
  ([changelogs/drizzle-zod/0.8.0.md](https://raw.githubusercontent.com/drizzle-team/drizzle-orm/main/changelogs/drizzle-zod/0.8.0.md)).
  Its peer range was `zod: ^3.25.0` — it reached the v4 API through zod 3.25's
  `zod/v4` subpath, and would **not** install against a `zod@4.x` package.
- **`0.8.3`** (2025-08-06) is the release that first accepts a `zod@4.x`
  *package*. Its changelog reads, in full: *"Update peerDeps for zod"*
  ([changelogs/drizzle-zod/0.8.3.md](https://raw.githubusercontent.com/drizzle-team/drizzle-orm/main/changelogs/drizzle-zod/0.8.3.md)),
  which is the widening to `^3.25.0 || ^4.0.0` visible in the packument.

So for a repo on `zod 4.5.4`, **0.8.3 is the floor, not merely the ceiling.**

This works because drizzle-zod imports from the `zod/v4` subpath — every
`.d.ts` in the published tarball begins `import type { z } from 'zod/v4'`, and
`index.mjs` begins `import { z } from 'zod/v4'`. **Measured** from the zod 4.5.4
tarball: `./v4/index.js` is `export * from "./classic/index.js"` over
`./v4/classic/external.js`, and the root `./index.js` is `export * from
"./v4/classic/external.js"` — the *same* module. So `zod` and `zod/v4` are one
instance under zod 4.x: no duplicated `ZodString` class, no `instanceof`
surprises, and a `z.string()` imported from `'zod'` is assignable where
drizzle-zod expects `zod/v4`'s. This is the thing that most often breaks in a
peer-dependency arrangement like this, and here it does not.

### Two facts to weigh before writing the ADR

**(a) drizzle-zod 0.8.3 predates drizzle-orm 0.45.x by seven months.** 0.8.3
shipped 2025-08-06; drizzle-orm 0.45.0 shipped 2025-12-04 and 0.45.2 on
2026-03-27. The `>=0.36.0` peer range is open-ended, so npm/pnpm are happy, but
nobody has cut a drizzle-zod release *against* 0.45.x. The compatibility
demonstrated in this document is empirical, not promised.

**(b) The standalone package is being absorbed.** The live documentation at
[orm.drizzle.team/docs/zod](https://orm.drizzle.team/docs/zod) — whose source is
[`src/content/docs/pg/zod.mdx`](https://raw.githubusercontent.com/drizzle-team/drizzle-orm-docs/main/src/content/docs/pg/zod.mdx)
— now opens with `npm i drizzle-orm@rc zod` and imports `createSelectSchema`
from **`drizzle-orm/zod`**, not from `drizzle-zod`. **Measured:** `drizzle-orm@0.45.2`
has **no** `./zod` export condition in its `package.json`; `drizzle-orm@1.0.0-beta.22`
does. So the documentation you will be reading describes the v1 release
candidate, while the code you will be writing uses the standalone 0.8.3 package.
The two are the same source tree at slightly different ages, but the import path
in every official example is wrong for us. Worth a line in the ADR: adopting
drizzle-zod today buys a migration to `drizzle-orm/zod` at the drizzle-orm v1
upgrade.

---

## 2. What each of the three functions generates

**Documented** shape, from
[`pg/zod.mdx`](https://raw.githubusercontent.com/drizzle-team/drizzle-orm-docs/main/src/content/docs/pg/zod.mdx):
select "defines the shape of data queried from the database", insert "the shape
of data to be inserted", update "the shape of data to be updated", and the
update example asserts `{ name?: string | undefined, age?: number | undefined }`.
The documentation does not enumerate the rules; the rules below are **measured**.

The precise rules live in the published `index.mjs` as three condition sets:

```js
const selectConditions = {
    never: () => false,
    optional: () => false,
    nullable: (column) => !column.notNull,
};
const insertConditions = {
    never: (column) => column?.generated?.type === 'always' || column?.generatedIdentity?.type === 'always',
    optional: (column) => !column.notNull || (column.notNull && column.hasDefault),
    nullable: (column) => !column.notNull,
};
const updateConditions = {
    never: (column) => column?.generated?.type === 'always' || column?.generatedIdentity?.type === 'always',
    optional: () => true,
    nullable: (column) => !column.notNull,
};
```

Read across, that is:

| Column trait | select | insert | update |
| --- | --- | --- | --- |
| `notNull()` | required | required | **optional** |
| nullable | `.nullable()`, required key | `.nullable().optional()` | `.nullable().optional()` |
| `.default(…)` / `.defaultNow()` | required | `.optional()` | `.optional()` |
| `$defaultFn(…)` | required | `.optional()` | `.optional()` |
| `serial()` | required | `.optional()` | `.optional()` |
| `.primaryKey()` | required | per its other traits | **`.optional()` — no special case** |
| `generatedAlwaysAs(…)` | present, nullable | **key absent** | **key absent** |
| `generatedAlwaysAsIdentity()` | present, required | **key absent** | **key absent** |
| `generatedByDefaultAsIdentity()` | present, required | `.optional()` | `.optional()` |

Three of these are worth saying out loud.

- **`createUpdateSchema` is not `insert.partial()`.** It is a separate build with
  `optional: () => true`. The difference that bites: the **primary key is
  present and optional** in the update schema. `createUpdateSchema(users).parse({ id: 7 })`
  succeeds, and feeding that straight into `db.update(users).set(…)` rewrites the
  key. If the API surface takes an update body from a client, the id must be
  `.omit()`ed explicitly.
- **`$defaultFn()` behaves exactly like `.default()`** for schema purposes,
  because drizzle-orm sets `hasDefault: true` for both. The insert schema will
  happily accept a payload with the column missing even though no *database*
  default exists — which is correct, since drizzle fills it, but means the zod
  schema is not a faithful description of what the database will accept.
- **Generated-always columns are dropped from insert *and* update, but kept in
  select** — the asymmetry the ORM needs, and the reason the update schema is
  not simply a `.partial()` of the select schema.

**Measured** — this exact assertion compiles clean, over a table carrying one
of each trait:

```ts
type I1 = Expect<Equal<Ins, {
  workspaceId: string; name: string; role: 'admin'|'member'|'viewer'; handle: string;
  id?: number | undefined;            // serial
  nickname?: string | null | undefined;
  active?: boolean | undefined;       // .default(true)
  slug?: string | undefined;          // $defaultFn
  createdAt?: Date | undefined;       // .defaultNow()
  byDefaultId?: number | undefined;   // generatedByDefaultAsIdentity
  // score (generatedAlwaysAs) and alwaysId (generatedAlwaysAsIdentity) absent
}>>;
```

and the runtime shapes print as:

```
SELECT  id:ZodNumberFormat workspaceId:ZodUUID name:ZodString nickname:ZodNullable
        role:ZodEnum handle:ZodAny active:ZodBoolean slug:ZodString createdAt:ZodDate
        score:ZodNullable alwaysId:ZodNumberFormat byDefaultId:ZodNumberFormat
INSERT  id:ZodOptional workspaceId:ZodUUID name:ZodString nickname:ZodOptional
        role:ZodEnum handle:ZodAny active:ZodOptional slug:ZodOptional
        createdAt:ZodOptional byDefaultId:ZodOptional
UPDATE  id:ZodOptional workspaceId:ZodOptional name:ZodOptional nickname:ZodOptional
        role:ZodOptional handle:ZodOptional active:ZodOptional slug:ZodOptional
        createdAt:ZodOptional byDefaultId:ZodOptional
```

Note `uuid()` → `ZodUUID` and `integer()` → `ZodInt` (printed as
`ZodNumberFormat`, zod 4's shared class for formatted numerics): integer columns
get a genuine integer check plus the width bounds from `CONSTANTS` in the
published source, not a bare `z.number()`.

---

## 3. Per-column refinement, and what happens under drift

### The supported API

**Documented** ([`pg/zod.mdx`, "Refinements"](https://raw.githubusercontent.com/drizzle-team/drizzle-orm-docs/main/src/content/docs/pg/zod.mdx)):

> Each create schema function accepts an additional optional parameter that you
> can used to extend, modify or completely overwite a field's schema. Defining a
> callback function will extend or modify while providing a Zod schema will
> overwrite it.

with the annotated example:

```ts
const userSelectSchema = createSelectSchema(users, {
  name: (schema) => schema.max(20),                  // Extends schema
  bio: (schema) => schema.max(1000),                 // Extends schema before becoming nullable/optional
  preferences: z.object({ theme: z.string() })       // Overwrites the field, including its nullability
});
```

The type that admits both forms, from the published `schema.types.internal.d.ts`:

```ts
type BuildRefineField<T> = T extends z.ZodType
  ? ((schema: T) => z.ZodType) | z.ZodType
  : never;
```

So: **the callback form is allowed on every column kind** — there is no column
class for which only a plain schema is accepted. (§4 shows this is a promise the
runtime does not keep for `customType`.)

### The two forms are not interchangeable

The single most surprising behaviour, and it is easy to hit. From the published
`index.mjs`:

```js
const refinement = refinements[key];
if (refinement !== undefined && typeof refinement !== 'function') {
    columnSchemas[key] = refinement;
    continue;                      // <-- skips the nullable/optional wrapping entirely
}
…
const refined = typeof refinement === 'function' ? refinement(schema) : schema;
…
if (conditions.nullable(column)) columnSchemas[key] = columnSchemas[key].nullable();
if (conditions.optional(column)) columnSchemas[key] = columnSchemas[key].optional();
```

A **plain schema replaces the field outright** — nullability and optionality
included. A **callback** is applied to the base schema and the result is then
wrapped as normal. The type level agrees with the runtime here
(`HandleRefinement` returns `TRefinement` verbatim for the non-callback branch),
so this is consistent, merely surprising.

**Measured**, on a *nullable* `text('nickname')` column in a select schema:

| refinement | runtime | `z.infer` |
| --- | --- | --- |
| `nickname: z.string()` | `ZodString` | `string` |
| `nickname: (s) => s.min(1)` | `ZodNullable` | `string \| null` |

The plain form silently made a nullable column non-nullable. In a select schema —
which is validating rows coming *out* of Postgres — that turns a legitimate
`NULL` into a parse failure at runtime, with no type error to warn you.
**Rule for this repo: use the callback form unless you specifically intend to
replace nullability too.**

### Drift: what happens when the column changes underneath

This is the load-bearing question, so each case is stated with its exact
compiler output. All **measured** under `typescript@7.0.2`, `strict`.

| Drift | Caught? | Where |
| --- | --- | --- |
| Column **dropped**, `createSelectSchema` | compile error — **at the table argument** | `TS2769: No overload matches this call.` |
| Column **dropped**, `createInsertSchema` | compile error — at the key | `TS2353: Object literal may only specify known properties, and 'gone' does not exist in type 'NoUnknownKeys<BuildRefine<Pick<…>>>'` |
| Column **dropped**, `createUpdateSchema` | compile error — at the key | `TS2353: … does not exist in type 'BuildRefine<Pick<…>>'` |
| Column **retyped**, plain-schema refinement (`title: z.number()` on a `text` column) | **NOT caught — silent** | *(no diagnostic)* |
| Column **retyped**, callback using a method the new base lacks | compile error — at the method | `TS2339: Property 'toLowerCase' does not exist on type 'ZodInt'.` |
| Column **retyped**, callback using a method both bases share (`.min(1)` on `ZodString` → `ZodInt`) | **NOT caught — silently changes meaning** | *(no diagnostic)* |
| Refinement key unknown, **at runtime** | never reached | `handleColumns` iterates *columns*, so an unknown refinement key is simply ignored |

Four things follow for an ADR on drift detection.

**Dropped columns are caught, but the select error is nearly useless.** The
guard type is
`NoUnknownKeys<TRefinement, TCompare> = { [K in keyof TRefinement]: K extends keyof TCompare ? … : DrizzleTypeError<'Found unknown key in refinement: "…"'> }`
(published `schema.types.internal.d.ts`). It is applied to the insert and select
overloads; `CreateUpdateSchema`'s refine parameter is plain `TRefine`, and update
is caught only by ordinary excess-property checking against the constraint. But
`CreateSelectSchema` has **five** overloads (table, table+refine, view,
view+refine, `PgEnum`), so a bad refinement key makes the table+refine overload
fail, TypeScript falls through to the last one, and you get
`TS2769 … is not assignable to parameter of type 'View<…>'` pointing at the
*table*, with a `Parameter 's' implicitly has an 'any' type` follow-on. The
`DrizzleTypeError` message never surfaces. A dropped column *will* fail `check`;
it will not tell you why.

**Retyped columns are the real hole.** `BuildRefineField` admits *any*
`z.ZodType` for the plain form — there is no constraint tying the refinement's
output back to the column's TS type. `createSelectSchema(t, { title: z.number() })`
on a `text('title')` column compiles clean, and the inferred type follows the
*refinement*: `Expect<Equal<D['title'], number>>` passes. The generated schema is
then a confident, well-typed lie about the table. **A refinement cannot be relied
on to fail when its column's type changes.**

**The callback form is a partial mitigation, and only a partial one.** It ties
the refinement to the base schema's *class*, so `text` → `integer` breaks
`.toLowerCase()`. But zod's `ZodString` and `ZodInt` share `.min`, `.max`,
`.refine`, `.transform`, `.optional` and more, so the very refinements most
likely to be written are the ones most likely to survive a type change with
altered meaning: `.min(1)` on a string means "non-empty", on an integer it means
"at least one".

**Therefore drift detection cannot be delegated to drizzle-zod.** Compile-time
coverage is: dropped columns yes (badly reported), retyped columns no. Whatever
mechanism T-011 chooses — a snapshot test over the generated shapes, a
`drizzle-kit generate` diff gate, or explicit `Expect<Equal<…>>` assertions
pinning each generated schema's `z.infer` against a hand-written type — must be
additive. The cheapest option that closes the retype hole is a per-table
`Expect<Equal<z.infer<typeof selectX>, …>>` assertion file, since that is exactly
the check the library declines to make.

---

## 4. Custom type mapping — and a type/runtime divergence

### How to override

There is no dedicated mechanism. A `customType` column is overridden the same way
as any other: a plain schema in the refinement object. **Not documented** — the
docs' data-type reference (`pg/zod.mdx`) covers built-in pg types only and never
mentions `customType`.

### The divergence

**Measured**, and this one is a genuine trap.

The type level maps a custom column by its *TypeScript* data type. From the
published `column.types.d.ts`, `GetZodPrimitiveType` ends:

```ts
… : TData extends string ? (… ? z.coerce.ZodCoercedString : z.ZodString) : z.ZodType;
```

So `customType<{ data: string; driverData: string }>('handle')` is typed as
`z.ZodString`, and `Expect<Equal<Sel['handle'], string>>` passes.

The runtime maps it by drizzle's `dataType` discriminator. From `index.mjs`:

```js
else if (column.dataType === 'custom') {
    schema = z$1.any();
}
```

Every `customType` column, regardless of its TS data type, becomes `z.any()`.
Measured: `SELECT … handle:ZodAny`, and for a `customType<{ data: number[] }>`
column, `schema.safeParse('not an array').success === true`.

Two consequences:

1. **Custom columns are unvalidated by default** while the inferred type claims
   they are validated. `z.infer` says `string`; `parse` accepts `42`.
2. **A callback refinement on a custom column throws at schema-construction
   time.** The types say the callback receives a `ZodString`, so
   `handle: (schema) => schema.min(3)` compiles; the runtime hands it a
   `ZodAny`, which has no `.min`. Measured:

   ```
   TypeError: schema.min is not a function
       at handleColumns (…/drizzle-zod/index.mjs:258:60)
       at createSelectSchema (…/drizzle-zod/index.mjs:300:12)
   ```

   This fires at module evaluation, not on first `parse`, so it is at least loud
   and early — but it is a runtime throw that the compiler actively told you was
   safe.

**Rule for this repo: every `customType` column must carry a plain-schema
refinement.** Never a callback. A lint rule or a review checklist item, because
the type system will not help.

Note the same shape of divergence, less severely, for `jsonb().$type<T>()`: the
type is `z.ZodType<T, T>` (from `column.types.d.ts`) but the runtime is the
generic `jsonSchema` union — measured as `ZodUnion` accepting arbitrary JSON. The
inferred type is `T`; the validation is "is JSON".

### Global / type-level hook

There is **none for type mapping**. `createSchemaFactory` is the only global
hook, and `CreateSchemaFactoryOptions` (published `schema.types.d.ts`) has
exactly two fields:

```ts
export interface CreateSchemaFactoryOptions<TCoerce …> {
    zodInstance?: any;
    coerce?: TCoerce;
}
```

- `zodInstance` swaps the zod used to *build* schemas — **documented** for
  extended instances such as `@hono/zod-openapi`
  ([`pg/zod.mdx`, "Factory functions"](https://raw.githubusercontent.com/drizzle-team/drizzle-orm-docs/main/src/content/docs/pg/zod.mdx)).
  Note it is typed `any`, so nothing about the extended instance is checked.
- `coerce` turns on `z.coerce.*` per primitive kind or wholesale with `true`
  — **documented** in the same section. Measured: `createSchemaFactory({ coerce: { number: true } })`
  makes an `integer()` column parse `"5"` into `5`.

Neither lets you say "map every `customType` named X to schema Y". Any global
mapping must be built on top — e.g. a thin wrapper that merges a shared
refinement object into every call.

---

## 5. `pgEnum`

**Documented** ([`pg/zod.mdx`](https://raw.githubusercontent.com/drizzle-team/drizzle-orm-docs/main/src/content/docs/pg/zod.mdx)):

```ts
const roles = pgEnum('roles', ['admin', 'basic']);
const rolesSchema = createSelectSchema(roles);
const parsed: 'admin' | 'basic' = rolesSchema.parse(...);
```

and the data-type reference states `pg.pgEnum('name', ['val1','val2'])` → `z.enum(['val1','val2'])`.

So there are two paths, both **measured**:

- **The enum object itself.** `createSelectSchema(roleEnum)` returns
  `z.ZodEnum<{ admin: 'admin'; member: 'member'; viewer: 'viewer' }>` — a
  standalone enum schema, no table involved. This overload exists on
  `CreateSelectSchema` only; there is no `createInsertSchema(enum)`.
- **A column of that enum inside a table** → the same `z.enum(column.enumValues)`.
  The runtime path is `isWithEnum`, which is `'enumValues' in column && Array.isArray(…) && length > 0`
  — so `text('role', { enum: [...] })` gets the identical treatment; the check is
  on the presence of `enumValues`, not on `pgEnum`-ness.

**Can it be narrowed below the column's allowed values? Yes — and nothing stops
you.** `createSelectSchema(users, { role: z.enum(['admin','member']) })` on a
three-value `pgEnum` compiles clean, `z.infer<…>['role']` narrows to
`'admin' | 'member'`, and at runtime a row with `role: 'viewer'` fails to parse.

That is useful when deliberate (an API surface that only exposes two of three
roles) and dangerous otherwise: a select schema that rejects rows the database
can legitimately return. Widening is equally unchecked — `z.enum([...])` with a
value the column does not allow also compiles. `BuildRefineField` accepts any
`z.ZodType`, so the enum members are never compared to `enumValues` at any level.
This is the §3 retype hole in its most likely-to-occur form: **adding a value to
a `pgEnum` will not fail any refinement that enumerates the old values.**

---

## 6. Generated and defaulted columns

Fully covered by the table in §2. Restated as rules, all **measured**, all
traceable to the `insertConditions` / `updateConditions` / `selectConditions`
objects quoted there:

- **`.default(v)` and `.defaultNow()`** set `hasDefault: true`. Effect: select
  unchanged (still required), insert `.optional()`, update `.optional()`.
- **`$defaultFn(fn)`** also sets `hasDefault: true` and is therefore
  *indistinguishable* from a database default at the schema level. Effect:
  identical to `.default()`. The generated schema cannot tell you whether the
  value comes from Postgres or from your process.
- **`serial()`** carries a default, so it lands in the same bucket: required in
  select, optional in insert and update.
- **`generatedAlwaysAs(expr)`** sets `generated.type === 'always'`. Effect:
  present-and-nullable in select, **key removed** from insert and update.
- **`generatedAlwaysAsIdentity()`** sets `generatedIdentity.type === 'always'`.
  Effect: present-and-required in select, **key removed** from insert and update.
- **`generatedByDefaultAsIdentity()`** sets `generatedIdentity.type === 'byDefault'`
  plus `hasDefault`. Effect: present-and-required in select, `.optional()` in
  insert and update.
- **`.primaryKey()`** has no effect of its own on any of the three schemas. In
  update it is optional like everything else; see the warning in §2.

One implementation detail worth knowing if you ever refine a generated column:
in `handleColumns`, the plain-schema `continue` happens *before* the
`conditions.never(column)` check. A plain-schema refinement on a generated-always
column would therefore reintroduce the key at runtime while the type level still
drops it. In practice this is unreachable without a cast, because
`CreateInsertSchema`/`CreateUpdateSchema` constrain refine keys to
`Pick<TTable['_']['columns'], keyof TTable['$inferInsert']>`, from which
generated-always columns are already absent — so the attempt is a compile error.
Flagged only because a `as any` anywhere near this code would produce a schema
whose runtime shape does not match its type.

---

## 7. Partitioned tables

**No first-party documentation found.**

- `pg/zod.mdx` never mentions partitioning; neither do the sibling dialect pages
  surfaced through context7 (`sqlite/zod.mdx`, `mssql/zod.mdx`, `cockroach/zod.mdx`).
- **Measured:** `PARTITION` appears nowhere in `drizzle-orm@0.45.2`'s `pg-core`
  type declarations. The only hit anywhere in `pg-core` is a commented-out SQL
  window function (`over (partition by …)`) in `dialect.js` — unrelated to table
  partitioning.

So drizzle-orm 0.45.2 has **no table-partitioning API**: no `PARTITION BY` clause
builder on `pgTable`, no partition-parent or partition-child concept. A
list-partitioned parent such as `index.chunk` must be declared to drizzle as an
ordinary `pgTable` (with the actual `PARTITION BY LIST (workspace_id)` and the
child partitions coming from hand-written SQL in a migration).

**Consequence for drizzle-zod: a partitioned parent is an ordinary table.** It
sees `getTableColumns(table)` and nothing else; `handleColumns` has no branch
that could behave differently. `createSelectSchema(chunk)` will describe the
parent's columns correctly. Two caveats, both inferences from the above rather
than documented facts:

- The partition key column is an ordinary column to drizzle-zod. It will appear
  in the insert schema as required (or optional if defaulted) with no indication
  that Postgres will reject a row whose key matches no partition.
- Because the partitioning lives in hand-written SQL that drizzle's schema does
  not model, `drizzle-kit`'s snapshot cannot be the sole drift signal for that
  table — which reinforces the §3 conclusion that drift detection needs its own
  mechanism.

---

## 8. Branded types

**Yes — brands round-trip, in both refinement forms.** This is the clearest win
in the whole investigation, and it is **not documented**; it falls out of the
types.

`HandleRefinement` (published `schema.types.internal.d.ts`) propagates the
refinement's own output type rather than reconciling it with the column's:

```ts
type HandleRefinement<TType, TRefinement, TColumn extends Column> =
  TRefinement extends (schema: any) => z.ZodType
    ? (TColumn['_']['notNull'] extends true ? ReturnType<TRefinement> : z.ZodNullable<ReturnType<TRefinement>>) extends infer TSchema extends z.ZodType
      ? TType extends 'update' ? z.ZodOptional<TSchema> : TSchema
      : z.ZodType
    : TRefinement;
```

For the callback form the result is literally `ReturnType<TRefinement>`; for the
plain form it is `TRefinement` itself. Neither is collapsed to the column's TS
type. So whatever the refinement's `z.infer` is, that is what the generated
schema's `z.infer` reports for that key.

**Measured** — both of these assertions compile clean:

```ts
const branded = createSelectSchema(users, {
  workspaceId: z.uuid().brand<'WorkspaceId'>(),      // plain replacement
  name: (schema) => schema.min(1).brand<'PersonName'>(), // callback
});
type B1 = Expect<Equal<z.infer<typeof branded>['workspaceId'], string & z.$brand<'WorkspaceId'>>>;
type B2 = Expect<Equal<z.infer<typeof branded>['name'],        string & z.$brand<'PersonName'>>>;
```

So the pattern this repo wants — a `WorkspaceId` that cannot be passed where a
`SourceId` is expected, enforced at the schema boundary — works.

Three cautions:

1. **Only the schema is branded, not the table.** `users.$inferSelect['workspaceId']`
   is still plain `string`; only `z.infer<typeof branded>` carries the brand. If
   you want the brand throughout, the generated schema (not the drizzle table)
   has to be the source of truth for application-level types.
2. **Use the callback form for nullable columns.** `workspaceId` above is
   `notNull`, so the plain replacement is harmless. On a nullable column the plain
   form would strip nullability (§3) while still branding — the brand would arrive
   attached to a wrong shape.
3. **The brand is exactly the §3 hole with the sign flipped.** The same
   "refinement output wins, unchecked" rule that makes brands work is what lets a
   `z.number()` sit on a `text` column undetected. You cannot have the first
   without the second, which is the trade-off the ADR should record.

---

## Recommendation for the ADR

Adopt **`drizzle-zod@0.8.3`** and write three rules alongside it:

1. **Callback refinements by default.** Plain-schema replacement only where
   replacing nullability is the intent — and never on a `customType` column,
   where it is instead mandatory.
2. **Refinements do not detect drift.** Add per-table
   `Expect<Equal<z.infer<typeof …>, …>>` assertions in `packages/schema`'s
   vitest suite. Dropped columns already fail `check` (poorly reported); retyped
   columns and widened `pgEnum`s do not fail anything at all, and that is the gap
   the assertions close.
3. **Plan for `drizzle-orm/zod`.** Keep every `drizzle-zod` import behind a single
   module in `packages/schema` so the v1 import-path change is one edit.

## Where the evidence lives

| Claim class | Artefact |
| --- | --- |
| versions, dates, peer ranges | `https://registry.npmjs.org/{drizzle-zod,drizzle-orm,drizzle-kit,zod}` |
| release notes | `https://raw.githubusercontent.com/drizzle-team/drizzle-orm/main/changelogs/drizzle-zod/{0.8.0,0.8.3}.md` |
| documented behaviour | `https://raw.githubusercontent.com/drizzle-team/drizzle-orm-docs/main/src/content/docs/pg/zod.mdx` (rendered at `https://orm.drizzle.team/docs/zod`) |
| type-level behaviour | published `drizzle-zod-0.8.3.tgz` → `schema.types.d.ts`, `schema.types.internal.d.ts`, `column.types.d.ts`, `utils.d.ts` |
| runtime behaviour | published `drizzle-zod-0.8.3.tgz` → `index.mjs` |
| measurements | throwaway project `/tmp/dztest` (`probe.ts`, `drift.ts`, `assert.ts`, `run.ts`) on the exact pinned versions; not part of this repo |
