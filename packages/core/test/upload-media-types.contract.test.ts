import { describe, expect, it } from "vitest";
import { z } from "zod";

import { UPLOAD_MEDIA_TYPES } from "../src/sources/index.ts";
import { contractFixture, mediaTypeOutside } from "./contract-fixture.ts";

const fixtureSchema = z.object({
  description: z.string(),
  admitted: z.array(z.string().min(1)),
  outside: z.array(mediaTypeOutside),
});

const fixture = contractFixture("upload-media-types", fixtureSchema);

describe("the media types the upload-media-types agreement admits", () => {
  it("are this tier's allow-list: every admitted type and no other", () => {
    expect([...UPLOAD_MEDIA_TYPES].toSorted()).toEqual(fixture.admitted.toSorted());
  });

  it("are each written once", () => {
    expect(new Set(fixture.admitted).size).toBe(fixture.admitted.length);
    expect(new Set(UPLOAD_MEDIA_TYPES).size).toBe(UPLOAD_MEDIA_TYPES.length);
  });

  it("places no type on both sides of the list", () => {
    expect(fixture.outside.length).toBeGreaterThan(0);
    for (const { media_type: mediaType } of fixture.outside) {
      expect({ mediaType, admitted: fixture.admitted.includes(mediaType) }).toEqual({
        mediaType,
        admitted: false,
      });
    }
  });
});
