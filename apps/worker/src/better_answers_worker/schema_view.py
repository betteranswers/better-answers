"""The worker's view of the schema — generated, never edited (ADR 0032).

Regenerate with `pnpm --filter @better-answers/schema run generate:worker-view`;
the drift test fails CI when this file and the journal disagree in either
direction. The worker never migrates (`[WRK1]`); this module is its read-only
knowledge of what the app's journal built, stamped with the migration id it was
generated from."""

MIGRATION_ID = "0002_chunk-and-functions"

TABLES: dict[str, dict[str, str]] = {
    "index.chunk": {
        "id": "text NOT NULL",
        "workspace_id": "text NOT NULL",
        "content": "text NOT NULL",
        "embedding": "vector(1024) NOT NULL",
        "embedding_route_id": "text NOT NULL",
        "published_at": "timestamp with time zone",
        "sensitivity": "text NOT NULL",
        "audience": "text NOT NULL",
        "binding_id": "text NOT NULL",
    },
    "public.llm_route": {
        "id": "text NOT NULL",
        "workspace_id": "text NOT NULL",
        "purpose": "llm_purpose NOT NULL",
        "provider": "text NOT NULL",
        "model": "text NOT NULL",
        "dimensions": "integer",
    },
    "public.workspace": {
        "id": "text NOT NULL",
        "name": "text NOT NULL",
        "created_at": "timestamp with time zone NOT NULL",
    },
}
