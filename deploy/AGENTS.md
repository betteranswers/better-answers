# deploy

- Nothing runs as root. A stateful service is a bind mount under `/data/<service>`, owned by its uid.
- A scheduled job verifies its upload against the bucket, writes a `backup` row, then pings the dead-man check.
- Staging holds synthetic data, except during a restore drill.
