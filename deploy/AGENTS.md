# deploy

- Nothing runs as root. A stateful service is a bind mount under `/data/<service>`, owned by its uid.
- A scheduled job verifies its upload against the bucket, writes a `backup` row, then pings the dead-man check. The ping carries an outcome word and sizes, never a path, key, workspace or error string.
- Staging holds synthetic data, except during a restore drill, and the drill's end wipes it.
- There is no metrics store and no scrape. A signal and an alert are queries over rows the platform already keeps.
