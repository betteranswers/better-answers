---
title: "Business logic is capability slices over four store doors in packages/core, under one import-direction lint rule"
date: 2026-09-22
module: packages/core
problem_type: architecture_pattern
component: kernel
severity: high
applies_when:
  - "Adding a slice, a store door or a directory under packages/core/src"
  - "Importing from one slice into another, or from a transport into packages/core"
  - "Writing a query against a table another slice owns"
  - "Writing a test that reaches Postgres, the object store, a git repository or the map"
  - "Adding a deployable under apps/"
tags:
  - adr-0029
  - slice
  - store-door
  - import-direction
  - kernel
  - access
  - exports-map
---

# Business logic is capability slices over four store doors in packages/core, under one import-direction lint rule

## The decision

The tree is `apps/` over `packages/`: `apps/` is what deploys and `packages/` is what is imported. `apps/api` is the product's one TypeScript deployable and holds transports only. Business logic is `packages/core`, a library the api depends on, organised as capability slices over four store doors.

`apps/test-inbox` is a second TypeScript deployable, and it is not the product. It is the journeys' test inbox: test infrastructure on Cloudflare, outside the product's two stacks and its four stores. The owner deploys it by hand with a pinned `wrangler`, and no image carries it. It imports nothing from `packages/core` at run time, only types from `packages/schema`.

- `kernel/` holds the Principal, branded ids, the error vocabulary and `Result`: types and pure functions.
- `access/` holds the read predicate, defined once with one SQL renderer.
- `store/` holds the four doors, one per shared store, and is the only place a connection is made: `store/postgres`, `store/git`, `store/map` and `store/objects`. Each door is exported under its own name, such as `@better-answers/core/store/postgres`. There is no `store` barrel and no `./store` entry.
- `llm/` and `audit/` are layers every slice may use.
- A slice is the capability that owns a set of tables and the invariants over them. The slices today are `sources`, `concepts`, `answering`, `guides`, `erasure`, `runs`, `workspaces`, `members` and `sweeps`. `erasure` sits on top, and nothing imports it.

The import direction has five rules:

1. `kernel` imports nothing else in core.
2. `access` imports only `kernel`. `store` imports only `kernel`, except that `store/map` also imports `access`, so a traversal template cannot exist without the predicate.
3. `llm` and `audit` import `kernel`, `access` and `store`, never a slice and never each other.
4. A slice reaches another slice only through its face, never its internals. The slice graph is acyclic.
5. Nothing in core imports a transport or a transport's dependency, such as `hono`, `@trpc`, `@modelcontextprotocol` or `better-auth`.

All five are one rule in the repository's own lint plugin, `better-answers/import-direction`, in `packages/devtools/lint-rules/rules/import-direction.ts`. It places both ends of an import in a zone by position under the package whose `package.json` names `@better-answers/core`. A face is a directory's `index.ts` that `packages/core/package.json`'s `exports` map names, and a face the map does not name is refused. Inside a slice, the slice is the unit, so its own subdirectories reach each other freely. `import/no-cycle` holds rule 4's acyclic clause. `packages/core/test/import-direction.test.ts` holds each refusal where it fires and where it stays silent.

Every query reaches its store through a store door in `packages/core/src/store/`. Row-level security is the tenancy guarantee (ADR 0032), and the door is ergonomics over it. A transaction that spans slices lives in the slice that owns the act.

Every one of the four doors is real in a test, and none may be faked: `CODING_STANDARDS.md`'s rule *Run every store the platform runs, for real*. An in-memory adapter is for a service someone else runs, such as an LLM provider, behind that service's own adapter. The test inbox's D1 is such a service: its store takes the few D1 calls it makes, and its suite runs the same SQL through `node:sqlite`.

## Why

- Business logic has five callers: tRPC, the MCP surface, `/agent/v1`, a script and the reconciler. Four of them have no notion of an HTTP status code, which belongs at the transport.
- A package is chosen over a directory for its export list: a declared, compiler-checked interface. It is not an import gate; the transport ban is a separate mechanism.
- Per-glob overrides held only two of the five rules. A probe ran ten cases, and seven that should have failed passed.
- One slice writing SQL against another slice's tables has no import statement, so no linter sees it. The checked-in table-ownership map, `packages/schema/src/table-ownership.ts`, is reviewed like the export list, and row-level security is the backstop.
- An `exports` entry nothing imports is interface nobody asked for.
- A faked door tests the fake. The four doors are stores the platform deploys and can start.

## Rejected

- A directory plus a lint rule: no export list, so an interface by convention only.
- Folders named for the knowledge layers plus `records/`: every capability cuts across them, and `records/` becomes a wastebasket.
- A `principal/` folder or a Control Centre folder: a Principal is a kernel type, and Control Centre composes slice reads in the api's routers.
- Two TypeScript deployables for the product, splitting `/agent/v1` off: nothing varies across that seam yet.
- Vertical slices with no cross-slice imports at all: slices share one database, so it forces duplicated queries or a `shared/` wastebasket.
- `resources/` for the persistence modules: *resource* is MCP's word.
- Flat top-level directories: what deploys against what is imported should be structural.
- A checked-in `layers.json` read by a lint rule: zones are read off position instead.
- The map door taking the rendered predicate as a parameter: a place a caller forgets.

## History

The full record, which retired the constitution's tenancy rule to ADR 0032 and whose tier-contract consequences ADR 0031 enacted and corrected, with its amendments (T-078, T-048, T-053, T-114, T-117, T-118, T-253): `docs/archive/adr/0029-apps-over-packages-capability-slices.md`.
