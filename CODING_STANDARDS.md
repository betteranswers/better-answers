# Coding rules

These bind every workspace. A gate enforces the rest, and its message names the fix. Rules for one directory live in that directory's `AGENTS.md`.

## Tests

- Test through the interface a caller crosses: `apps/api` through `server.request(...)`, `apps/worker` through the job or module entry point, `packages/core` through an entry its `exports` map names, and `apps/web` as a browser drives the served build, or a component through Testing Library. Hand a sibling workspace shared test infrastructure through a `./testing` entry.
- Use the real Postgres, object store, git repository and map. An in-memory adapter stands in only for a service someone else runs, such as an LLM provider, behind that service's own adapter.
- Postgres aborts the transaction after a failed statement, even a caught one. In a test that provokes a failure, assert the rejection or the rows before any returned value.
- A lint rule, a `check` tool or a hook lands with a test that runs the real tool over a throwaway tree (`packages/devtools/src/throwaway-tree.ts`), and asserts where it fires and where it stays silent.

## Code

- Return an error as a `Result`. Catch only around an external library, and wrap its throw with `normalizeError`.
- Suffix a money or time value with its unit: `timeoutMs`, `priceCents`.
- Read the environment only in the tier's config module. Pass it to a child process through one named function.

## Data and secrets

- Log through pino or structlog. Prompt and completion content never reach a logger, an exporter or a row.
- A secret belongs to one of the seven credential classes in `docs/operations/SECRETS.md`. A config module reads the bootstrap class. Never mix classes in one scope, and never log a secret.
- No LLM-authored SQL runs against a shared store.

## Domain

- Code takes the word `CONCEPTS.md` gives a thing. Define a missing word there in the same change as its first use.
- A concept file carries what OKF v0.2 defines, plus `iri` and `sources[].locator`. A new key needs a decision record that argues it against the bundle-alone test in `docs/okf-v02.md`.

## Dependencies

- Read every dependency, image, extension and tool version from the vendor's release page or Context7 at the time of the change, and name the source in the pull request.
- Pin each value once, in the file its updater writes: an exported constant in the owning package, or the manifest a Renovate manager keeps (compose, Dockerfile `ARG`, `.tool-versions`). A consumer reads that one and refuses zero or several matches.
