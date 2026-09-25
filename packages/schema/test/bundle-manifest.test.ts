import { describe, expect, it } from "vitest";

import { BUNDLE_MANIFEST_PATH, bundleManifest } from "../src/index.ts";

const MANIFEST = {
  id: "01J6BBBBBBBBBBBBBBBBBBBBBB",
  origin: "company",
  ref: "Company, Website, LMS and Audits bid libraries, reviewed 22 September 2026",
  owner: "Acme",
  content_version: "2026-09-22",
};

describe("the bundle manifest, the file a bundle describes itself with", () => {
  it("sits at the bundle's root under the platform's reserved name", () => {
    expect(BUNDLE_MANIFEST_PATH).toBe("knowledge/manifest.yaml");
  });

  it("accepts the five keys, trimming what a person typed", () => {
    expect(bundleManifest.parse({ ...MANIFEST, owner: "  Acme  " })).toEqual(MANIFEST);
  });

  it.each([
    ["an id not the minter's", { ...MANIFEST, id: "acme-2026" }],
    ["an unknown origin", { ...MANIFEST, origin: "vendor" }],
    ["a blank owner", { ...MANIFEST, owner: "   " }],
    ["a blank content version", { ...MANIFEST, content_version: "" }],
    ["a key of its own", { ...MANIFEST, name: "Acme's bundle" }],
    ["a missing key", { id: MANIFEST.id, origin: "company", ref: MANIFEST.ref, owner: "Acme" }],
  ])("refuses a manifest with %s", (_why, malformed) => {
    expect(bundleManifest.safeParse(malformed).success).toBe(false);
  });
});
