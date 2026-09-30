# Coding rules — `apps/worker/`

The whole of `CODING_STANDARDS.md` binds this workspace. What follows is true of this tier alone.

## [WRK1] Never migrate, and never hold a git credential

The api is the only migration owner and the only OKF writer, and it is the tier that holds the credential a write to the bundle needs. This tier reads the schema as structure, proposes a concept through a `concept_write_request` row, and claims no job while either stamp disagrees with what it carries: the schema stamp against the migration journal's last instant, and `contract_stamp` against its own generated digest of `contracts/`.

## [PIPE1] Compose cocoindex; never rebuild what it provides and never rely on what it does not

A cocoindex type never crosses a module seam: the import is banned tier-wide and lifted for `pipeline/` alone. Every cocoindex target is `managed_by="user"`, the api owning all DDL.

## [WRK2] Keep a test to its own database, directory and threads

`check` runs the suite over four processes, and no test knows which of them runs it or what ran there before. A test takes its database from `tests/pg_harness.py`, which clones a fresh one for each call. It writes under `tmp_path` alone, and joins every thread it starts before it returns. It waits on a condition, never on a fixed pause. Work paid once a run, such as the image build, carries an `xdist_group`.
