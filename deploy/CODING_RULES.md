# Coding rules — `deploy/`

The whole of `CODING_RULES.md` binds this directory. What follows is true of the deployment configuration alone.

## [OPS1] Own state on disk, prove every job, and wipe staging

Nothing runs as root: a stateful service is a bind mount under `/data/<service>` owned by its uid. A scheduled job verifies its upload against the bucket, writes a `backup_run` row, then pings the dead-man check — an outcome word and sizes, never a path, key, workspace or error string. Staging holds synthetic data outside a restore drill, and the drill's end wipes it. An image deploys by digest; no compose file starts without one.

## [OPS2] Keep a signal and an alert as rows

There is no metrics store and no scrape: a signal and an alert are queries over rows the platform already keeps.
