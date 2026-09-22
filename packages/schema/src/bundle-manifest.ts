import { z } from "zod";

import { ULID } from "./ulid.ts";

export const BUNDLE_MANIFEST_PATH = "knowledge/manifest.yaml";

const BUNDLE_ORIGINS = ["company"] as const;

const line = z.string().trim().min(1);

export const bundleManifest = z.strictObject({
  id: z.string().regex(ULID),
  origin: z.enum(BUNDLE_ORIGINS),
  ref: line,
  owner: line,
  content_version: line,
});

export type BundleManifest = z.infer<typeof bundleManifest>;
