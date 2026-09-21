import { describe, expect, it } from "vitest";
import { z } from "zod";

import { UPLOAD_MEDIA_TYPES } from "../src/sources/index.ts";
import { contractFixture, mediaTypeOutside } from "./contract-fixture.ts";

/**
 * The upload-media-types agreement's TypeScript half (ADR 0031): the fixture in
 * `contracts/upload-media-types/` is the contract — the media types an upload is admitted
 * under — and this suite holds this tier's allow-list to it. The Python half is
 * `apps/worker/tests/test_upload_media_types_contract.py`, where the same file is read by the
 * tier that converts what this one admitted.
 *
 * **Why a list of four strings is an agreement.** The bind act refuses a media type outside
 * the list while the Admin still has the file; the worker's converter dispatches on the same
 * types and quarantines the rest. A type this tier admits and the worker cannot convert is a
 * binding that will never answer anything, and nothing fails until an Admin finds their
 * document quarantined — so each tier's list is held to one file rather than to the other's
 * constant, which a TypeScript tier and a Python tier could not share in any case.
 *
 * Neither half holds the other's literals: this one reads `UPLOAD_MEDIA_TYPES`, the constant
 * the bind act enforces, and the Python half reads the keys of the converter's dispatch. The
 * refusal itself — the bind act answering `media-type-refused` for each type the agreement
 * places outside the list — is the seeded half's, in `sources.test.ts`, beside the stores the
 * bind act writes to.
 */

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

  it("are each written once, so a list of four is four types", () => {
    expect(new Set(fixture.admitted).size).toBe(fixture.admitted.length);
    expect(new Set(UPLOAD_MEDIA_TYPES).size).toBe(UPLOAD_MEDIA_TYPES.length);
  });

  it("places no type on both sides of the list", () => {
    // A type both admitted and outside would make the seeded half and this one disagree about
    // the same file, and whichever ran last would look like the broken one.
    expect(fixture.outside.length).toBeGreaterThan(0);
    for (const { media_type: mediaType } of fixture.outside) {
      expect({ mediaType, admitted: fixture.admitted.includes(mediaType) }).toEqual({
        mediaType,
        admitted: false,
      });
    }
  });
});
