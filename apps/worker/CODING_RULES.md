# Coding rules — `apps/worker/`

The whole of `CODING_RULES.md` binds this workspace. What follows is true of this tier
alone. Each rule names what holds it, because a rule nothing runs is a convention — and in
this tier most of them are held by `pyproject.toml`, which one `check` reads on every run.

## [WRK1] The worker never migrates and never holds a git credential

The app is the only migration owner (ADR 0007) and the only OKF writer (ADR 0005). The
worker reads the schema as structure, proposes a concept through a `concept_write_request`
row, and refuses to claim jobs when its schema stamp does not match `__drizzle_migrations`.

The stamp is the checked half — `tests/test_work_loop.py`,
`test_the_loop_claims_nothing_when_its_schema_stamp_does_not_match`. The two bans are read
off the diff: no ruff banned-api rule names a migration library or a git one, so a migration
written here or a credential held here is caught in review, against ADR 0007 and ADR 0005
rather than against a gate.

## [WRK2] One logger, one config module

`log.py` is the tier's only logger — structlog, JSON to stdout, `print` banned outside
scripts (`[LOG1]`). `config.py` is the only module in the tier that reads the environment
(`[SEC1]`), and it reads the **bootstrap class alone** — what the deploy unit must give the
process before it can reach anything. Every other credential class is a row under the
envelope, injected per run through the control plane, so the worker never holds the master
key. A variable no step in this tier reads yet does not belong in that module.

`print` is held by ruff's `T20`, with `check.py` its one exemption. The two singularities
are held by nothing and need a reviewer: this tier's shape is one logger and one config
module, and a second of either shows in the diff that adds it.

## [WRK3] `check` is one command that reports everything

`uv run --frozen check` runs ruff, ruff format, mypy and pytest — this tier's whole gate,
under `[CHECK3]`, whose runner here is `check.py`. It is what the root `check` calls and
what CI calls; there is no second list of steps anywhere.

## [WRK4] Typed at every public boundary

mypy runs strict over `src` and `tests`; ruff's `ANN` rules mean an untyped signature does
not lint. Both are held by `pyproject.toml` and run on every `check`, which is why no test
and no ADR names this rule. `Any` is a review question (§ TYPES (Python)) and names its
holder in saying so.
