/**
 * The one pinned database image (ADR 0032): the official pgvector image on Postgres 18,
 * by digest. Read on 01/09/2026 from Docker Hub's tag API:
 * pgvector/pgvector 0.8.6-pg18-trixie → sha256:78bf48b8… . The Testcontainers harness,
 * the worker-view generator and the deploy unit all run this ref; a version move is one
 * edit here plus the compose digest.
 */
export const POSTGRES_IMAGE =
  "pgvector/pgvector:0.8.6-pg18-trixie@sha256:78bf48b801e792f99e3ac62b5036fd3876e9be48afda16c1e331af1c75ceb2ff";
