import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ISSUE_WORDS, parse, ROOT_PATH, type IssueWord } from "../../src/kernel/index.ts";
import {
  connectUploadFields,
  dismissAsNotSpecialCategoryInput,
  findingsOfInput,
  keepInTextInput,
  narrowConnectedSourceInput,
  narrowDocumentsInput,
  previewPassagesInput,
  publishConnectedSourceInput,
  reprocessConnectedSourceInput,
} from "../../src/sources/index.ts";

const A_WORKSPACE = "01JQ0000000000000000000WSP";
const A_CONNECTED_SOURCE = "01J6NNNNNNNNNNNNNNNNNNNNN1";
const A_GROUP = "01J6NNNNNNNNNNNNNNNNNNNNN2";
const A_FINDING = "01J6NNNNNNNNNNNNNNNNNNNNN3";
const A_DOCUMENT = "01J6NNNNNNNNNNNNNNNNNNNNN4";

const SECRET = "37 Baker Street, sort code 01-02-03";

const REASON = "The sort code is the company's own, printed on every invoice it sends.";

const CONFIRMED = {
  lawfulBasisRecorded: true,
  privacyInformationUpdated: true,
  dpiaReferenced: true,
} as const;

const ALWAYS_GROUP = {
  documentId: A_DOCUMENT,
  category: "bank-details",
  ruleId: "sort-code-with-account-number",
  tier: "always",
} as const;

const refusalOf = (read: ReturnType<typeof parse>) => (read.ok ? "ok" : read.error);

const A_AND_B = ["a", "b"] as const;

const EVERY_ISSUE: ReadonlyArray<readonly [IssueWord, string, z.ZodType, unknown]> = [
  ["missing", "field", z.object({ field: z.string() }), {}],
  ["wrong-type", "field", z.object({ field: z.string() }), { field: 1 }],
  ["too-small", "field", z.object({ field: z.string().min(2) }), { field: "a" }],
  ["too-big", "field", z.object({ field: z.string().max(1) }), { field: "ab" }],
  ["bad-format", "field", z.object({ field: z.string().regex(/^x$/) }), { field: "y" }],
  ["not-a-multiple", "field", z.object({ field: z.number().multipleOf(3) }), { field: 4 }],
  ["not-in-set", "field", z.object({ field: z.enum(A_AND_B) }), { field: "c" }],
  [
    "no-shape-matches",
    "field",
    z.object({ field: z.union([z.string(), z.number()]) }),
    { field: true },
  ],
  ["unrecognised-key", ROOT_PATH, z.strictObject({ field: z.string() }), { field: "a", other: 1 }],
  [
    "bad-key",
    "field.other",
    z.object({ field: z.record(z.string().regex(/^field$/), z.number()) }),
    { field: { other: 1 } },
  ],
  ["refused", "field", z.object({ field: z.string().refine(() => false) }), { field: "a" }],
];

describe("the kernel's parse", () => {
  it("returns the parsed value when the schema accepts the input", () => {
    const read = parse(narrowConnectedSourceInput, {
      connectedSourceId: A_CONNECTED_SOURCE,
      sensitivity: "Restricted",
      audience: "everyone",
    });

    expect(read).toEqual({
      ok: true,
      value: {
        connectedSourceId: A_CONNECTED_SOURCE,
        visibility: { sensitivity: "Restricted", audience: "everyone", audienceGroups: null },
      },
    });
  });

  it("reports the failing field's issue word without its value", () => {
    const read = parse(connectUploadFields, {
      connectedSourceId: A_CONNECTED_SOURCE,
      name: SECRET,
      fileName: "handbook.md",
      mediaType: "text/markdown",
      byteSize: -1,
    });

    expect(read).toEqual({
      ok: false,
      error: { word: "malformed", fields: { byteSize: "too-small" } },
    });
    expect(JSON.stringify(read)).not.toContain("01-02-03");
    expect(JSON.stringify(read)).not.toContain("-1");
  });

  it("leaves out every bad value when every field fails", () => {
    const read = parse(keepInTextInput, {
      connectedSourceId: SECRET,
      groupsOfFindings: [{ ...ALWAYS_GROUP, tier: SECRET }],
      reason: "",
    });

    expect(read).toEqual({
      ok: false,
      error: {
        word: "malformed",
        fields: {
          connectedSourceId: "bad-format",
          "groupsOfFindings.0.tier": "not-in-set",
          reason: "too-small",
        },
      },
    });
    expect(JSON.stringify(read)).not.toContain("Baker Street");
  });

  it("names a nested field by its dotted path", () => {
    const { dpiaReferenced: _dropped, ...part } = CONFIRMED;

    expect(
      parse(publishConnectedSourceInput, {
        connectedSourceId: A_CONNECTED_SOURCE,
        confirmations: part,
      }),
    ).toEqual({
      ok: false,
      error: { word: "malformed", fields: { "confirmations.dpiaReferenced": "missing" } },
    });
  });

  it("reports a nested undefined key as missing", () => {
    expect(
      parse(publishConnectedSourceInput, {
        connectedSourceId: A_CONNECTED_SOURCE,
        confirmations: { ...CONFIRMED, dpiaReferenced: undefined },
      }),
    ).toEqual({
      ok: false,
      error: { word: "malformed", fields: { "confirmations.dpiaReferenced": "missing" } },
    });
  });

  it("reports the root as missing when the input is undefined", () => {
    expect(parse(findingsOfInput, undefined)).toEqual({
      ok: false,
      error: { word: "malformed", fields: { [ROOT_PATH]: "missing" } },
    });
  });

  it("reports the root as wrong-type for a non-object input", () => {
    expect(parse(findingsOfInput, "not an object")).toEqual({
      ok: false,
      error: { word: "malformed", fields: { [ROOT_PATH]: "wrong-type" } },
    });
  });

  it.each(EVERY_ISSUE)("reports %s for the matching schema issue", (word, path, schema, raw) => {
    expect(refusalOf(parse(schema, raw))).toEqual({
      word: "malformed",
      fields: { [path]: word },
    });
  });

  it("has a case for every issue word, and no others", () => {
    const reached = EVERY_ISSUE.map(([word]) => word);

    expect([...ISSUE_WORDS].filter((word) => !reached.includes(word))).toEqual([]);
    expect(reached.filter((word) => !ISSUE_WORDS.includes(word))).toEqual([]);
  });
});

describe("the Sources actions' input schemas", () => {
  it("defaults a connect's visibility to Restricted, everyone, no groups", () => {
    const read = parse(connectUploadFields, {
      connectedSourceId: A_CONNECTED_SOURCE,
      name: "The staff handbook",
      fileName: "handbook.md",
      mediaType: "text/markdown",
      byteSize: 43,
    });

    expect(read).toEqual({
      ok: true,
      value: {
        connectedSourceId: A_CONNECTED_SOURCE,
        name: "The staff handbook",
        fileName: "handbook.md",
        mediaType: "text/markdown",
        byteSize: 43,
        visibility: { sensitivity: "Restricted", audience: "everyone", audienceGroups: null },
      },
    });
  });

  it("refuses an audience that disagrees with its group list", () => {
    const named = parse(narrowConnectedSourceInput, {
      connectedSourceId: A_CONNECTED_SOURCE,
      sensitivity: "Internal",
      audience: "everyone",
      audienceGroups: [A_GROUP],
    });
    const bare = parse(narrowConnectedSourceInput, {
      connectedSourceId: A_CONNECTED_SOURCE,
      sensitivity: "Internal",
      audience: "groups",
    });

    expect([refusalOf(named), refusalOf(bare)]).toEqual([
      { word: "malformed", fields: { audience: "refused" } },
      { word: "malformed", fields: { audience: "refused" } },
    ]);
  });

  it("refuses an empty group list", () => {
    expect(
      refusalOf(
        parse(narrowConnectedSourceInput, {
          connectedSourceId: A_CONNECTED_SOURCE,
          sensitivity: "Internal",
          audience: "groups",
          audienceGroups: [],
        }),
      ),
    ).toEqual({ word: "malformed", fields: { audienceGroups: "too-small" } });
  });

  it("defaults a missing preview limit to 20, refusing fractions", () => {
    expect(
      refusalOf(parse(previewPassagesInput, { connectedSourceId: A_CONNECTED_SOURCE, limit: 2.5 })),
    ).toEqual({
      word: "malformed",
      fields: { limit: "wrong-type" },
    });
    expect(parse(previewPassagesInput, { connectedSourceId: A_CONNECTED_SOURCE })).toEqual({
      ok: true,
      value: { connectedSourceId: A_CONNECTED_SOURCE, limit: 20 },
    });
  });

  it("defaults a document narrowing to Restricted, keeping its finding groups", () => {
    expect(
      parse(narrowDocumentsInput, {
        connectedSourceId: A_CONNECTED_SOURCE,
        groupsOfFindings: [ALWAYS_GROUP],
      }),
    ).toEqual({
      ok: true,
      value: {
        connectedSourceId: A_CONNECTED_SOURCE,
        groupsOfFindings: [ALWAYS_GROUP],
        sensitivity: "Restricted",
      },
    });
  });

  it("refuses an invalid reprocess reason and an unknown finding tier", () => {
    for (const reason of ["spring-clean", "bound", "restored", "narrowed"]) {
      expect(
        refusalOf(
          parse(reprocessConnectedSourceInput, {
            workspaceId: A_WORKSPACE,
            connectedSourceId: A_CONNECTED_SOURCE,
            reason,
          }),
        ),
      ).toEqual({ word: "malformed", fields: { reason: "not-in-set" } });
    }
    expect(
      refusalOf(
        parse(keepInTextInput, {
          connectedSourceId: A_CONNECTED_SOURCE,
          groupsOfFindings: [{ ...ALWAYS_GROUP, tier: "sometimes" }],
          reason: REASON,
        }),
      ),
    ).toEqual({ word: "malformed", fields: { "groupsOfFindings.0.tier": "not-in-set" } });
  });

  it("refuses a missing, blank or overlong dismissal reason", () => {
    for (const [reason, word] of [
      [undefined, "missing"],
      ["   ", "too-small"],
      ["x".repeat(1_001), "too-big"],
    ] as const) {
      expect(
        refusalOf(
          parse(dismissAsNotSpecialCategoryInput, {
            connectedSourceId: A_CONNECTED_SOURCE,
            groupsOfFindings: [ALWAYS_GROUP],
            reason,
          }),
        ),
      ).toEqual({ word: "malformed", fields: { reason: word } });
    }
  });

  it("accepts ULID ids and refuses a lower-case one", () => {
    const kept = parse(keepInTextInput, {
      connectedSourceId: A_CONNECTED_SOURCE,
      groupsOfFindings: [ALWAYS_GROUP],
      reason: REASON,
    });

    expect(kept).toEqual({
      ok: true,
      value: {
        connectedSourceId: A_CONNECTED_SOURCE,
        groupsOfFindings: [ALWAYS_GROUP],
        reason: REASON,
      },
    });
    expect(
      refusalOf(parse(findingsOfInput, { connectedSourceId: A_FINDING.toLowerCase() })),
    ).toEqual({
      word: "malformed",
      fields: { connectedSourceId: "bad-format" },
    });
  });
});
