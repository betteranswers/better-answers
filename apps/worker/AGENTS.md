# apps/worker

- The worker never migrates and never holds a git credential. The api owns every migration, every OKF write and the bundle's credential. The worker proposes a concept through a `concept_write_request` row.
- Every cocoindex target is `managed_by="user"`, because the api owns all DDL.
- `check` runs the suite over four xdist processes. A test takes its database from `tests/pg_harness.py`, writes under `tmp_path` alone, joins every thread it starts, and waits on a condition, never a fixed pause. Work paid once a run, such as the image build, carries an `xdist_group`.
