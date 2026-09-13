/**
 * The one pinned object-store image: Garage, the S3-compatible store the estate runs
 * (ADR 0007; `deploy/stores.compose.yaml` § objectstore), by digest. The tag was read on
 * 28/08/2026 from Docker Hub and the digest beside it on 03/09/2026 from Docker Hub's tag
 * API, which is where a move reads the next one.
 *
 * The Testcontainers harness and the compose service run this one ref, so a version move
 * is one edit here and the compose digest beside it; `apps/api/tests/deploy-tree.test.ts`
 * holds the two together, the way it holds the database image, because a copy is a second
 * pin that ages on its own.
 */
export const GARAGE_IMAGE =
  "dxflrs/garage:v2.3.0@sha256:866bd13ed2038ba7e7190e840482bc27234c4afaf77be8cfa439ae088c1e4690";
