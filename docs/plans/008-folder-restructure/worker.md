# Explore: worker (`apps/worker`)

Read-only survey of `apps/worker/src/better_answers_worker/` and `apps/worker/tests/` on `refactor/folder-restructure`. Every `file:line` below was read or grepped in this worktree.

Correction to the brief's counts. The package root holds 19 files (18 modules plus `__init__.py`), not 20, and 2 subpackages (`pipeline/`, `redaction/`), not 3. `tests/` holds 48 loose files (40 `test_*.py`, `conftest.py`, 6 helpers, a tracked `.gitkeep`) and one data subfolder, `fixtures/` (`conversion/`, `redaction/`).

## 1. Inventory

| Folder | Loose files now | After |
| --- | --- | --- |
| `src/better_answers_worker/` | 19 | 14 |
| `src/better_answers_worker/concepts/` (new) | 0 | 6 (5 moved plus an empty `__init__.py`) |
| `src/better_answers_worker/pipeline/` | 10 | 10 (pinned, see Risks) |
| `src/better_answers_worker/redaction/` | 16 | 16 (pinned, see Risks; one over the ~15 guide, left on purpose) |
| `tests/` | 48 | 11 (`conftest.py` plus 10 tests) |
| `tests/concepts/` (new) | 0 | 4 |
| `tests/pipeline/` (new) | 0 | 8 |
| `tests/redaction/` (new) | 0 | 11 |
| `tests/gates/` (new) | 0 | 7 |
| `tests/support/` (new) | 0 | 7 (6 helpers plus an empty `__init__.py`) |
| `tests/fixtures/{conversion,redaction}/` | 5 / 4 | unchanged |

## 2. Target tree and move table

```
src/better_answers_worker/
  __init__.py check.py config.py contract_digest.py contract_stamp.py envelope.py
  generate_contract_stamp.py health.py ids.py kinds.py log.py loop.py queue.py schema_view.py
  concepts/   __init__.py audit.py bundle.py concept_file.py links.py rebuild.py
  pipeline/   (unchanged)
  redaction/  (unchanged)
tests/
  conftest.py test_config.py test_cost_ledger_contract.py test_credential_envelope_contract.py
  test_image.py test_log_bridge.py test_pg_harness.py test_planted_page.py test_sql_prepares.py
  test_tier_contract.py test_work_loop.py
  concepts/   test_concept_file.py test_links.py test_links_contract.py test_reader_linear.py
  pipeline/   test_document_passage_contract.py test_emptying_a_connected_source_contract.py
              test_pipeline_engine_environment.py test_pipeline_host.py test_pipeline_index.py
              test_pipeline_landed.py test_sync_sensitivity_moves_contract.py
              test_upload_media_types_contract.py
  redaction/  test_detection_key.py test_erasure_match_contract.py test_redaction.py
              test_redaction_contract.py test_redaction_descriptors.py
              test_redaction_runtime_environment.py test_redaction_suffixes.py
              test_redaction_weights.py test_redaction_windows.py
              test_the_detector_holds_its_weights_once.py test_the_detector_is_paid_for_late.py
  gates/      test_cocoindex_ban.py test_complexity_cap.py test_daemon_skip_is_loud.py
              test_directive_rules.py test_monkeypatch_guard.py test_pytest_options.py
              test_title_hold.py
  support/    __init__.py bundles.py deploy_unit.py factories.py import_watch.py pg_harness.py planted_page.py
  fixtures/   (unchanged)
```

Why `concepts/`. The five modules read the knowledge base (an OKF bundle of concepts, GLOSSARY "Knowledge base", "Concept") and keep the map in step with it. They import only each other plus `ids` and `log`. `packages/core/src/concepts/` is the TypeScript home of the same work (`concept_file.py` declares `PORT_OF = ("packages/core/src/concepts/file.ts",)` at `concept_file.py:24`). No file is renamed. `concepts/concept_file.py` repeats its folder; renaming it to `concepts/file.py` would mirror `packages/core/src/concepts/file.ts`, but it is optional and not recommended here (rule 5).

Why `gates/`. Those seven tests exercise the suite's own rules (the conftest guard, title cap, daemon-skip summary), the check runner's pytest options, and ruff config (`TID251` ban, complexity cap, directive rules). They mirror `pyproject.toml` and `conftest.py`, not a source module.

Why the other tests stay at root. Each mirrors a root module (`loop`/`queue`/`kinds` for `test_work_loop`, `config`, `log`, `envelope`) or is tier-wide (`test_tier_contract`, `test_sql_prepares`, `test_cost_ledger_contract`). `test_image.py` is pinned by CI (see 3). `test_pg_harness.py` and `test_planted_page.py` test the support helpers and stay at root so `support/` holds no collected tests.

### Move table (every file that moves; `git mv`)

Source (`apps/worker/src/better_answers_worker/` prefix):

| Old | New |
| --- | --- |
| `audit.py` | `concepts/audit.py` |
| `bundle.py` | `concepts/bundle.py` |
| `concept_file.py` | `concepts/concept_file.py` |
| `links.py` | `concepts/links.py` |
| `rebuild.py` | `concepts/rebuild.py` |
| (new, empty) | `concepts/__init__.py` |

Tests (`apps/worker/tests/` prefix):

| Old | New |
| --- | --- |
| `test_concept_file.py` | `concepts/test_concept_file.py` |
| `test_links.py` | `concepts/test_links.py` |
| `test_links_contract.py` | `concepts/test_links_contract.py` |
| `test_reader_linear.py` | `concepts/test_reader_linear.py` |
| `test_document_passage_contract.py` | `pipeline/test_document_passage_contract.py` |
| `test_emptying_a_connected_source_contract.py` | `pipeline/test_emptying_a_connected_source_contract.py` |
| `test_pipeline_engine_environment.py` | `pipeline/test_pipeline_engine_environment.py` |
| `test_pipeline_host.py` | `pipeline/test_pipeline_host.py` |
| `test_pipeline_index.py` | `pipeline/test_pipeline_index.py` |
| `test_pipeline_landed.py` | `pipeline/test_pipeline_landed.py` |
| `test_sync_sensitivity_moves_contract.py` | `pipeline/test_sync_sensitivity_moves_contract.py` |
| `test_upload_media_types_contract.py` | `pipeline/test_upload_media_types_contract.py` |
| `test_detection_key.py` | `redaction/test_detection_key.py` |
| `test_erasure_match_contract.py` | `redaction/test_erasure_match_contract.py` |
| `test_redaction.py` | `redaction/test_redaction.py` |
| `test_redaction_contract.py` | `redaction/test_redaction_contract.py` |
| `test_redaction_descriptors.py` | `redaction/test_redaction_descriptors.py` |
| `test_redaction_runtime_environment.py` | `redaction/test_redaction_runtime_environment.py` |
| `test_redaction_suffixes.py` | `redaction/test_redaction_suffixes.py` |
| `test_redaction_weights.py` | `redaction/test_redaction_weights.py` |
| `test_redaction_windows.py` | `redaction/test_redaction_windows.py` |
| `test_the_detector_holds_its_weights_once.py` | `redaction/test_the_detector_holds_its_weights_once.py` |
| `test_the_detector_is_paid_for_late.py` | `redaction/test_the_detector_is_paid_for_late.py` |
| `test_cocoindex_ban.py` | `gates/test_cocoindex_ban.py` |
| `test_complexity_cap.py` | `gates/test_complexity_cap.py` |
| `test_daemon_skip_is_loud.py` | `gates/test_daemon_skip_is_loud.py` |
| `test_directive_rules.py` | `gates/test_directive_rules.py` |
| `test_monkeypatch_guard.py` | `gates/test_monkeypatch_guard.py` |
| `test_pytest_options.py` | `gates/test_pytest_options.py` |
| `test_title_hold.py` | `gates/test_title_hold.py` |
| `bundles.py` | `support/bundles.py` |
| `deploy_unit.py` | `support/deploy_unit.py` |
| `factories.py` | `support/factories.py` |
| `import_watch.py` | `support/import_watch.py` |
| `pg_harness.py` | `support/pg_harness.py` |
| `planted_page.py` | `support/planted_page.py` |
| (new, empty) | `support/__init__.py` |
| `.gitkeep` | deleted (tracked, dead in a non-empty folder) |

Basenames stay unique across all test folders. That is load-bearing: pytest's default `prepend` import mode imports a test in a folder without `__init__.py` by its bare basename, so two `test_x.py` in different folders would collide. No test folder gets an `__init__.py` or its own `conftest.py` (a second `conftest` module name would collide the same way).

## 3. Path coupling

### Python import paths (all must change)

Source, relative imports (`src/better_answers_worker/`):
- `kinds.py:5` `from .audit import run_audit` becomes `from .concepts.audit import run_audit`.
- `kinds.py:8` `from .rebuild import analyse_map, run_rebuild` becomes `from .concepts.rebuild import ...`.
- `rebuild.py:17` `from .log import logger` becomes `from ..log import logger`.
- `bundle.py:8` `from .ids import ID_SHAPE` becomes `from ..ids import ID_SHAPE`.
- Unchanged because siblings move together: `audit.py:6-7`, `rebuild.py:6-9`, `links.py:5`.
- No lazy (function-body) import of a moved module exists in `src`.

Tests, absolute `better_answers_worker.<moved>` imports:
- `.bundle`: `bundles.py:7`, `test_work_loop.py:19`.
- `.concept_file`: `bundles.py:8`, `factories.py:9`, `test_concept_file.py:3`, `test_links.py:1`, `test_tier_contract.py:686`, `test_tier_contract.py:707` (the last two are function-body imports).
- `.links`: `test_links.py:2`, `test_links_contract.py:5`, `test_reader_linear.py:4`.
- `.audit`: `test_work_loop.py:18`.
- `.rebuild`: `test_work_loop.py:29`.
- No `from better_answers_worker import <moved>` form exists (the package-level forms import only `queue`, `config`, `pipeline`, `loop`, `health`).

Tests, bare helper imports (all become `from support.<name> import`):
- `bundles`: `factories.py:11`, `test_concept_file.py:12`, `test_work_loop.py:31`.
- `pg_harness`: `factories.py:12`, `test_pg_harness.py:21`, `test_pipeline_host.py:26`, `test_pipeline_index.py:55`, `test_sql_prepares.py:14`, `test_work_loop.py:40`, `test_cost_ledger_contract.py:42,71`, `test_tier_contract.py:391,473,503,596` (function-body).
- `factories`: `test_pipeline_host.py:25`, `test_pipeline_index.py:43`, `test_work_loop.py:32`, `test_cost_ledger_contract.py:70`, `test_tier_contract.py:390,432,536,559` (function-body).
- `planted_page`: `test_image.py:22`, `test_pipeline_index.py:56`, `test_planted_page.py:3`, `test_redaction.py:22`, `test_redaction_windows.py:12`.
- `deploy_unit`: `test_config.py:12`, `test_image.py:21`, `test_pipeline_engine_environment.py:3`.
- `import_watch`: `test_pipeline_engine_environment.py:4`, `test_redaction_runtime_environment.py:8`.
- Inside child-process strings: `test_pg_harness.py:237` and `:514` (`from pg_harness import ...` after `sys.path.insert(0, tests)` at `:235`, `:512`) become `from support.pg_harness import ...`. The inserted path stays `Path(__file__).parent` (`:245`, `:526`) because `test_pg_harness.py` stays at root.

Bare names that keep working unchanged, because `tests/` stays on `sys.path`:
- `test_daemon_skip_is_loud.py:3` and `test_image.py:20` `from conftest import ...`.
- `test_pytest_options.py:4` `import test_image`.

### String module names and path literals inside tests

- `test_sql_prepares.py:48-57` `SENDING_MODULES` holds `"audit"` and `"rebuild"` as names relative to the package root (built at `:113`). They become `"concepts.audit"` and `"concepts.rebuild"`. A dotted-prefix regex will miss them because they carry no `better_answers_worker.` prefix. Loud: `:432` asserts set equality.
- `test_monkeypatch_guard.py:22` `"better_answers_worker.config.read_bootstrap"`. `config` does not move. No `mock.patch` string targets exist anywhere (`unittest.mock` and `mock` are banned at `pyproject.toml:220-221`).
- `conftest.py:6` `OWN_PACKAGE = "better_answers_worker"`. Package name unchanged.
- `test_cocoindex_ban.py:62` uses the synthetic filename `"tests/test_redaction.py"` to show the ban covers tests. It still holds after the move. Updating it to `tests/redaction/test_redaction.py` is optional fidelity.
- Child-process import strings name only unmoved modules: `test_redaction_runtime_environment.py:24,28,33,45,54`, `test_the_detector_is_paid_for_late.py:39,44,45,54,63-64`, `test_log_bridge.py:50`, `test_pipeline_engine_environment.py:14`, `test_work_loop.py:1252-1253,1390`, `test_image.py:581-638,734,1165`.

### Entry points (none move)

- `pyproject.toml:119` `check = "better_answers_worker.check:main"`, `:121` `better-answers-worker = "better_answers_worker.loop:main"`, `:125` `generate-contract-stamp = "better_answers_worker.generate_contract_stamp:main"`.
- `apps/worker/Dockerfile:66` copies `src/better_answers_worker/__init__.py`, `:68` copies `src/better_answers_worker/redaction`, `:81` `python -m better_answers_worker.redaction.weights`, `:99` `python -m better_answers_worker.redaction.suffixes`, `:186` `COPY src src`, `:203-204` `HEALTHCHECK ... python -m better_answers_worker.health`, `:210` `CMD ["better-answers-worker"]`.
- `deploy/platform.compose.yaml:94` healthcheck `python -m better_answers_worker.health`.
- `packages/core/test/worker-process.ts:65` spawns `uv run --frozen better-answers-worker --once` (by script name).
- `packages/schema/test/rls.test.ts:488,590` name `better-answers-worker` (the role or service name, not a module).
- `.github/workflows/build.yml:92` and `scripts/cloud-setup.sh:37` `from better_answers_worker.redaction.weights import fetch`.
- `.github/workflows/build.yml:146` `pytest tests/test_image.py` (probe leg).

### Tooling config naming worker paths

- `pyproject.toml:231` per-file ignore `src/better_answers_worker/check.py`, `:238` `src/better_answers_worker/pipeline/**`, `:243` mypy `files = ["src", "tests"]`, `:205` ruff `src = ["src", "tests"]`, `:271` pytest `testpaths = ["tests"]`, `:318-320` mutmut `source_paths`, `do_not_mutate` (check.py) and `tests/` selection. All recursive or name unmoved files. No coverage config exists.
- `pyproject.toml` comments that name moved tests: `:67` `apps/worker/tests/test_pipeline_engine_environment.py`, `:236` `tests/test_cocoindex_ban.py`. Update the prose. Comments naming `tests/test_image.py` (`:58,103,128,313`) stay true.
- `packages/devtools/src/insert-scan.ts:10-11` `FACTORY_MODULES` lists `apps/worker/tests/factories.py` and `apps/worker/tests/pg_harness.py`. Both become `tests/support/...`. Loud: `packages/devtools/test/insert-scan.test.ts:109` asserts each exists. Also update the synthetic tree key at `insert-scan.test.ts:162`; `:65` stays true either way.
- `packages/devtools/test/ci/docs-lane.test.ts:438` and `:446` name `apps/worker/tests/test_redaction.py` and `test_redaction_windows.py`. Both move to `tests/redaction/`. Loud: `:511` asserts each `suite.file` exists, `:497` matches by basename (unchanged). `:451` (`test_planted_page.py`), `:462` (`test_tier_contract.py`), `:470` (`test_image.py`) stay. `:747-748` use `test_pipeline_landed.py` as a synthetic changed path; optional update.
- `scripts/docs-lane.mjs:30-32` `IMAGE_INPUTS` names `src/better_answers_worker/__init__.py`, `src/better_answers_worker/redaction/`, `tests/test_image.py`. All pinned. `docs-lane.test.ts:393` asserts they exist and `:308-312` resolves `build.yml:146`'s probe file.
- `packages/devtools/src/comment-inventory.ts:325-334`, `packages/devtools/python/comment_gate.py:75` (`A_TEST_PATH` matches any `tests/` segment), `packages/devtools/src/paths.ts:8-10` (`tests` directory or `test_` prefix), `packages/devtools/python/port_scan.py:212` (`rglob("*.py")` under `apps/worker/src`, from `package.json:34`): all path-agnostic. `PORT_OF` declarations in `concept_file.py:24` and `links.py:24` move with their files.
- `jscpd.config.mjs:15`, `packages/devtools/test/jscpd.test.ts:99`, `packages/schema/scripts/generate-worker-schema.ts:12`, `packages/schema/test/worker-schema-view.test.ts:17`: `schema_view.py`, pinned.
- `packages/devtools/test/contract-digest.test.ts:10`: `contract_stamp.py`, pinned.
- `.github/workflows/build.yml:65,98`, `check.yml:210,253,364`: `hashFiles('.../redaction/pins.py')` cache keys, pinned.
- `lefthook.yml:21-34` (`*.py` globs under `apps/worker/`), `cubic.yaml:71` (`apps/worker/tests/**`), `.gitnexusignore:107` (`apps/worker/tests/`), `.dockerignore` (`tests`): recursive, no change.
- No `CODEOWNERS` entry names the worker.

### Docs and prose naming moved paths (no gate reads them)

- `contracts/links/cases.json:2` (`links.py`, `apps/worker/tests/test_links_contract.py`), `contracts/document-passage/cases.json:2`, `contracts/erasure-match/cases.json:2`, `contracts/redaction/cases.json:2`, `contracts/upload-media-types/cases.json:2` (moved test paths in `description`). Neither tier's contract test parses `description`. **Do not edit these in the move commit; see Risks.**
- `docs/operations/CI.md:109` (`apps/worker/tests/test_redaction_descriptors.py`).
- `docs/solutions/logic-errors/python-unquote-is-not-javascript-decodeuri.md:11` (`applies_when` cites `apps/worker/src/better_answers_worker/links.py`), `docs/solutions/logic-errors/two-tiers-regex-engines-split-lines-and-whitespace-differently.md:55` (same path).
- `docs/solutions/integration-issues/a-store-reopened-in-one-process-races-the-engines-teardown-of-its-last-handle.md:15,45,75` (`test_pipeline_landed.py`, `test_pipeline_host.py`).
- `docs/plans/007-s3-concepts-and-guides.md:687-758` (`links.py`, `rebuild.py`, `test_links*.py`). Plan record; update only if plans are kept live.
- `apps/worker/tests/fixtures/conversion/README.md:10` (`tests/test_pipeline_landed.py`). `fixtures/redaction/README.md:9,19` name `planted_page.py` and `test_redaction_windows.py` by basename; still true.
- `docs/archive/plans/*` and `.planning/` mention old paths; archive, leave.
- Unaffected because they name pinned files: `.env.example:7`, `.cubic/wiki/05-s-backend/02-p-worker-tier.md:11` (`config.py`), `.claude/skills/renovate-prs/SKILL.md:76`, `docs/operations/BUILD_CACHE.md:65-81`, `docs/operations/RUNBOOK.md:225,238`, `docs/operations/local-gates.md:172`, `docs/specs/route/s4.md:16`, `s6.md:15,22`, `contracts/README.md:11`.

### `Path(__file__)` arithmetic in files that move one level deeper

Every `parents[N]` shifts to `parents[N+1]` and every `.parent / "fixtures"` becomes `.parents[1] / "fixtures"`. Nothing checks these by import; a wrong one fails at first use, or silently reads the wrong tree if the shifted path happens to exist.

| File (new location) | Line | Change |
| --- | --- | --- |
| `concepts/test_links_contract.py` | 14 | `parents[3]` to `parents[4]` |
| `pipeline/test_pipeline_landed.py` | 100 | `parents[3]` to `parents[4]` |
| `pipeline/test_pipeline_landed.py` | 103 | `.parent / "fixtures"` to `.parents[1] / "fixtures"` |
| `pipeline/test_pipeline_landed.py` | 609 | `parents[1]` to `parents[2]` |
| `pipeline/test_pipeline_index.py` | 177 | `.parent / "fixtures"` to `.parents[1] / "fixtures"` |
| `pipeline/test_document_passage_contract.py` | 17 | `parents[3]` to `parents[4]` |
| `pipeline/test_emptying_a_connected_source_contract.py` | 7 | `parents[3]` to `parents[4]` |
| `pipeline/test_sync_sensitivity_moves_contract.py` | 21 | `parents[3]` to `parents[4]` |
| `pipeline/test_upload_media_types_contract.py` | 9 | `parents[3]` to `parents[4]` |
| `redaction/test_redaction_suffixes.py` | 11 | `parents[1]` to `parents[2]` |
| `redaction/test_redaction_weights.py` | 13 | `parents[1]` to `parents[2]` |
| `redaction/test_redaction_contract.py` | 13 | `parents[3]` to `parents[4]` |
| `redaction/test_redaction_descriptors.py` | 43 | `parents[1]` to `parents[2]` (`:44` derives from it) |
| `redaction/test_erasure_match_contract.py` | 20 | `parents[3]` to `parents[4]` |
| `gates/test_cocoindex_ban.py` | 8 | `parents[1]` to `parents[2]` |
| `gates/test_complexity_cap.py` | 9 | `parents[1]` to `parents[2]` (`:11` derives from it) |
| `gates/test_pytest_options.py` | 7 | `parents[1]` to `parents[2]` |
| `gates/test_directive_rules.py` | 7 | `parents[1]` to `parents[2]` |
| `gates/test_title_hold.py` | 9 | `Path(__file__).with_name("conftest.py")` to `Path(__file__).resolve().parents[1] / "conftest.py"` |
| `support/pg_harness.py` | 21 | `parents[3]` to `parents[4]` |
| `support/deploy_unit.py` | 5 | `parents[3]` to `parents[4]` |
| `support/planted_page.py` | 6 | `TEST_DIRECTORY = ...parent` to `...parents[1]` (keeps `:7` `parents[2]`, `:10`, `:14` correct) |

Source modules that move have no `__file__` arithmetic. `contract_digest.py:4` (`parents[4]`) stays put.

## 4. Import rewrite mechanics

- `src` uses relative imports throughout (`from .x`, `from ..x`). Only four lines change (listed above).
- Tests use absolute `better_answers_worker.<module>` imports plus bare helper names. Bare names resolve because pytest `prepend` mode puts `tests/` (the folder of the root `conftest.py`, which has no `__init__.py`) on `sys.path`.
- **Helper import decision.** `tests/support/__init__.py` (empty) plus `from support.<name> import`, with `pythonpath = ["tests"]` added to `[tool.pytest.ini_options]` so the `tests/` entry is declared rather than a side effect of conftest insertion. The `__init__.py` matters for mypy (`files = ["src", "tests"]`, `pyproject.toml:243`). mypy names a file by walking up to the first folder without `__init__.py`. Without it, `tests/support/factories.py` would be module `factories` (base `tests/support`) while tests import `support.factories` (base `tests`), and mypy reports "Source file found twice under different module names". With it, both are `support.factories`. ruff isort classifies `support` as first-party because `tests/support/` exists under `src = ["src", "tests"]`; `ruff check --fix` reorders the import blocks.
- Rejected alternatives. `pythonpath = ["tests/support"]` with bare names unchanged hides where `factories` lives and needs `tests/support` added to ruff's `src`. `tests/__init__.py` everywhere with `from tests.support...` changes every test's module name and the `conftest` and `test_image` bare imports.
- **Tool.** A short Python script (rerunnable, checked into the PR description or `.audit/`, not the repo) that does `git mv` per the move table, then regex rewrites: `\bbetter_answers_worker\.(audit|bundle|concept_file|links|rebuild)\b` to `better_answers_worker.concepts.\1` and `better_answers_worker/(audit|bundle|concept_file|links|rebuild)\.py` to `better_answers_worker/concepts/\1.py` over `apps/worker`, `packages`, `docs`, `scripts`, `.github` (not `contracts/`, not `docs/archive/`); `^(\s*)from (bundles|deploy_unit|factories|import_watch|pg_harness|planted_page) import` to `\1from support.\2 import` over `apps/worker/tests` (catches the function-body imports); and the explicit per-file `parents[]` edits from the table above (a table-driven edit, not a blanket regex, because root-level tests keep their numbers). Then hand-edit the four `src` relative imports, `SENDING_MODULES`, the two `test_pg_harness.py` child strings, `insert-scan.ts`, `docs-lane.test.ts`, and `pyproject.toml`. Then `uv run --frozen ruff check --fix src tests` and `ruff format`. libcst or rope are unnecessary: every import is one of a handful of literal shapes.
- **Proof.** Before and after: `uv run --frozen pytest --collect-only -q -p no:cacheprovider | tail -1` must report the same count; `uv run --frozen mypy`; `uv run --frozen check`; `pnpm --filter @better-answers/devtools exec vitest run test/insert-scan.test.ts test/ci/docs-lane.test.ts test/contract-digest.test.ts`; `python3 packages/devtools/python/port_scan.py apps/worker/src`; `uv run --frozen python -c "import better_answers_worker.kinds"`.

## 5. Risks

- **`pipeline/detected.py` must not move (behaviour change).** The cocoindex memo identity includes the function's module, `THE_MEMOS_MODULE = detected._fn.__module__` (`pipeline/detected.py:44`), asserted as `"better_answers_worker.pipeline.detected"` at `test_pipeline_landed.py:601` and by path at `:622`. Moving or renaming it changes the memo key and discards every stored detection. Other `@coco.fn` functions (`pipeline/landed.py:133,178,246`, `pipeline/tables.py:41,55`) may also be keyed by module path inside cocoindex; that is a guess I did not verify. Leave the whole `pipeline/` package in place.
- **`redaction/` must stay whole and in place.** The Dockerfile copies it into an early build layer before the rest of `src` (`Dockerfile:66-68`) so the weights fetch (`:81`) and suffix step (`:99`) cache independently. `test_image.py:1349-1377` reconstructs module names assuming `redaction/` sits directly under the package and asserts it imports nothing else from the tier. `test_image.py:1327-1346` asserts no module reaches the build stage before `uv sync`. Five CI cache keys hash `redaction/pins.py`. 16 files is one over the guide; a split (say, `dismissals`, `restores`, `suppressions`, `withholdings`, `officers` into `redaction/outcomes/`) is possible because the seam test already handles subfolders (`:1354`), but it buys one file under the line for test and import churn in 7 test files and `pipeline/landed.py`, `pipeline/run.py`, `pipeline/catalogue.py`. Not recommended.
- **Editing `contracts/*/cases.json` changes the contract digest.** `contract_digest.py:13-36` hashes every file under `contracts/` except `README.md`, so a prose edit to a `description` changes `CONTRACT_DIGEST`. Both stamps (`apps/worker/src/better_answers_worker/contract_stamp.py`, `packages/schema/src/contract-stamp.ts`) must regenerate, and the worker refuses work until the database stamp matches (`loop.py:82`). Keep those five description fixes out of the move, or in their own commit with both stamps regenerated.
- **Silent `parents[N]` drift.** A shifted path that still exists reads the wrong tree without failing. The table in 3 is exhaustive for moved files (grep of `__file__|parents\[|\.parent\b` over `tests`).
- **Basename collisions.** Covered above. Keep every test basename unique and add no `__init__.py` or `conftest.py` under test folders.
- **Glob discovery.** `test_sql_prepares.py:372` and `test_pipeline_landed.py:615` `rglob` the source tree; both still find moved files, and `SENDING_MODULES` is the one name-keyed table that changes. `pg_harness.py:210` globs migrations (repo-relative, fixed by the `parents` shift).
- **Probe leg.** `build.yml:146` runs `pytest tests/test_image.py` from the `probe` dependency group. It loads `conftest.py` and imports `support.deploy_unit` and `support.planted_page`; both are plain-Python helpers, so the probe still runs. Verify the leg locally with `uv run --frozen --only-group probe pytest tests/test_image.py --collect-only`.
- **Gates that count files per folder.** None found for Python.

## 6. Big-file split

- `schema_view.py` (803 lines). Generated (`schema_view.py:1` "Generated, never edited: pnpm --filter @better-answers/schema run generate:worker-view"). No split.
- `links.py` (832 lines). Optional, and I recommend deferring it to its own PR: it is a line-for-line port of `packages/schema/src/concept-file.ts` and `packages/core/src/store/map/index.ts` (`links.py:24-27`), and its seams follow those files only loosely. If done, it becomes `concepts/links/` with `__init__.py` re-exporting the current `__all__` (`links.py:814-832`) plus `PORT_OF` and `AGREEMENT`, so `better_answers_worker.concepts.links` stays the import name and `port_scan.py:212` still finds the declaration. Proposed modules and line ranges:
  - `scan.py`: 31-161 (line starts, stop scanning, autolink and bracket-form spans, `_link_matches`).
  - `fences.py`: 164-274 (`_OpenedFence`, fenced blocks, `_blanked_spans`, `prose_of`).
  - `definitions.py`: 277-394 (label normalising, `_target_after`, definitions, sources, `_link_target_of`).
  - `targets.py`: 397-467 (URI decode, `_target_of`).
  - `sentences.py`: 470-588 (`_section_at`, labels, flattening, `_paragraph_around`, `_sentence_at`).
  - `__init__.py` or `edges.py`: 591-811 (`BodyLink`, `CitationMark`, `links_and_marks_of`, `OutgoingReference`, `references_of`, `ResolvedTarget`, `UnresolvedReference`, `unresolved_references`, `OutgoingEdge`, `outgoing_edges`).
  The underscored helpers cross the new module seams, so they become imports of private names across modules. That is the cost that makes this a separate decision.
