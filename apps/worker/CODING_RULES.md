# Coding rules — `apps/worker/`

The whole of `CODING_RULES.md` binds this workspace. What follows is true of this tier alone.

## [WRK1] Never migrate, and never hold a git credential

The app is the only migration owner and the only OKF writer. This tier reads the schema as structure, proposes a concept through a `concept_write_request` row, and claims no job while its schema stamp does not match the migration journal's.

## [PIPE1] Compose cocoindex; never rebuild what it provides and never rely on what it does not

A cocoindex type never crosses a module seam: the import is banned tier-wide and lifted for `pipeline/` alone. Every cocoindex target is `managed_by="user"`, the app owning all DDL.
