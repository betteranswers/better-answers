# Coding rules — `apps/worker/`

The whole of `CODING_RULES.md` binds this workspace. What follows is true of this tier
alone.

## [WRK1] The worker never migrates and never holds a git credential

The app is the only migration owner (ADR 0007) and the only OKF writer (ADR 0005). The
worker reads the schema as structure, proposes a concept through a `concept_write_request`
row, and refuses to claim jobs when its schema stamp does not match `__drizzle_migrations`.

## [WRK2] One logger, one config module

`log.py` is the tier's only logger — structlog, JSON to stdout, `print` banned outside
scripts (`[LOG1]`). `config.py` is the only module in the tier that reads the environment
(`[SEC1]`), and it reads the **bootstrap class alone** — what the deploy unit must give the
process before it can reach anything. Every other credential class is a row under the
envelope, injected per run through the control plane, so the worker never holds the master
key. A variable no step in this tier reads yet does not belong in that module.

## [WRK3] `check` is one command that reports everything

`uv run --frozen check` runs ruff, ruff format, mypy and pytest, and runs every step even
when an earlier one fails, so one run names every problem rather than the first. It is what
the root `check` calls and what CI calls; there is no second list of steps anywhere.

## [WRK4] Typed at every public boundary

mypy runs strict over `src` and `tests`; ruff's `ANN` rules mean an untyped signature does
not lint. `Any` is a review question (§ TYPES (Python)).
