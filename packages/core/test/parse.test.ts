import { describe, expect, it } from "vitest";

import { z } from "zod";

import { ISSUE_WORDS, parse, ROOT_PATH, type IssueWord } from "../src/kernel/index.ts";
import {
  bindUploadFields,
  dismissAsNotSpecialCategoryInput,
  findingsOfInput,
  keepInTextInput,
  narrowBindingInput,
  narrowDocumentsInput,
  previewChunksInput,
  publishBindingInput,
  reprocessBindingInput,
} from "../src/sources/index.ts";

const A_WORKSPACE = "01JQ0000000000000000000WSP";
const A_BINDING = "01J6NNNNNNNNNNNNNNNNNNNNN1";
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

/** One case per word, so the walk below proves both directions of the register. */
const EVERY_ISSUE: ReadonlyArray<readonly [IssueWord, string, z.ZodType, unknown]> = [
  ["missing", "field", z.object({ field: z.string() }), {}],
  ["wrong-type", "field", z.object({ field: z.string() }), { field: 1 }],
  ["too-small", "field", z.object({ field: z.string().min(2) }), { field: "a" }],
  ["too-big", "field", z.object({ field: z.string().max(1) }), { field: "ab" }],
  ["bad-format", "field", z.object({ field: z.string().regex(/^x$/) }), { field: "y" }],
  ["not-a-multiple", "field", z.object({ field: z.number().multipleOf(3) }), { field: 4 }],
  ["not-in-set", "field", z.object({ field: z.enum(["a", "b"]) }), { field: "c" }],
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

describe("what a kernel parse answers", () => {
  it("hands back the branded value a schema admits", () => {
    const read = parse(narrowBindingInput, {
      bindingId: A_BINDING,
      sensitivity: "Restricted",
      audience: "everyone",
    });

    expect(read).toEqual({
      ok: true,
      value: {
        bindingId: A_BINDING,
        visibility: { sensitivity: "Restricted", audience: "everyone", audienceGroups: null },
      },
    });
  });

  it("names the failing field with a word, never its value", () => {
    const read = parse(bindUploadFields, {
      bindingId: A_BINDING,
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

  it("carries no offending value when every field is wrong", () => {
    const read = parse(keepInTextInput, {
      bindingId: SECRET,
      findingGroups: [{ ...ALWAYS_GROUP, tier: SECRET }],
      reason: "",
    });

    expect(read).toEqual({
      ok: false,
      error: {
        word: "malformed",
        fields: {
          bindingId: "bad-format",
          "findingGroups.0.tier": "not-in-set",
          reason: "too-small",
        },
      },
    });
    expect(JSON.stringify(read)).not.toContain("Baker Street");
  });

  it("names a nested field by the path that reaches it", () => {
    const { dpiaReferenced: _dropped, ...part } = CONFIRMED;

    expect(parse(publishBindingInput, { bindingId: A_BINDING, confirmations: part })).toEqual({
      ok: false,
      error: { word: "malformed", fields: { "confirmations.dpiaReferenced": "missing" } },
    });
  });

  it("reads a nested undefined key as a missing one", () => {
    expect(
      parse(publishBindingInput, {
        bindingId: A_BINDING,
        confirmations: { ...CONFIRMED, dpiaReferenced: undefined },
      }),
    ).toEqual({
      ok: false,
      error: { word: "malformed", fields: { "confirmations.dpiaReferenced": "missing" } },
    });
  });

  it("calls the whole value missing when nothing was handed in", () => {
    expect(parse(findingsOfInput, undefined)).toEqual({
      ok: false,
      error: { word: "malformed", fields: { [ROOT_PATH]: "missing" } },
    });
  });

  it("names the root when the whole value is mistyped", () => {
    expect(parse(findingsOfInput, "not an object")).toEqual({
      ok: false,
      error: { word: "malformed", fields: { [ROOT_PATH]: "wrong-type" } },
    });
  });

  it.each(EVERY_ISSUE)(
    "answers %s for the issue a schema raises with it",
    (word, path, schema, raw) => {
      expect(refusalOf(parse(schema, raw))).toEqual({
        word: "malformed",
        fields: { [path]: word },
      });
    },
  );

  it("owns every issue word and reaches each one", () => {
    const reached = EVERY_ISSUE.map(([word]) => word);

    expect([...ISSUE_WORDS].filter((word) => !reached.includes(word))).toEqual([]);
    expect(reached.filter((word) => !ISSUE_WORDS.includes(word))).toEqual([]);
  });
});

describe("the shapes the Sources acts are handed", () => {
  it("defaults a bind's class, audience and groups to the narrowest", () => {
    const read = parse(bindUploadFields, {
      bindingId: A_BINDING,
      name: "The staff handbook",
      fileName: "handbook.md",
      mediaType: "text/markdown",
      byteSize: 43,
    });

    expect(read).toEqual({
      ok: true,
      value: {
        bindingId: A_BINDING,
        name: "The staff handbook",
        fileName: "handbook.md",
        mediaType: "text/markdown",
        byteSize: 43,
        visibility: { sensitivity: "Restricted", audience: "everyone", audienceGroups: null },
      },
    });
  });

  it("refuses an audience word and group list that disagree", () => {
    const named = parse(narrowBindingInput, {
      bindingId: A_BINDING,
      sensitivity: "Internal",
      audience: "everyone",
      audienceGroups: [A_GROUP],
    });
    const bare = parse(narrowBindingInput, {
      bindingId: A_BINDING,
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
        parse(narrowBindingInput, {
          bindingId: A_BINDING,
          sensitivity: "Internal",
          audience: "groups",
          audienceGroups: [],
        }),
      ),
    ).toEqual({ word: "malformed", fields: { audienceGroups: "too-small" } });
  });

  it("refuses a fractional preview limit and defaults an absent one", () => {
    expect(refusalOf(parse(previewChunksInput, { bindingId: A_BINDING, limit: 2.5 }))).toEqual({
      word: "malformed",
      fields: { limit: "wrong-type" },
    });
    expect(parse(previewChunksInput, { bindingId: A_BINDING })).toEqual({
      ok: true,
      value: { bindingId: A_BINDING, limit: 20 },
    });
  });

  it("defaults a narrowing to the narrowest class, keeping its groups", () => {
    expect(
      parse(narrowDocumentsInput, { bindingId: A_BINDING, findingGroups: [ALWAYS_GROUP] }),
    ).toEqual({
      ok: true,
      value: {
        bindingId: A_BINDING,
        findingGroups: [ALWAYS_GROUP],
        sensitivity: "Restricted",
      },
    });
  });

  it("refuses a non-reprocess reason and an unknown finding tier", () => {
    for (const reason of ["spring-clean", "bound", "restored", "narrowed"]) {
      expect(
        refusalOf(
          parse(reprocessBindingInput, {
            workspaceId: A_WORKSPACE,
            bindingId: A_BINDING,
            reason,
          }),
        ),
      ).toEqual({ word: "malformed", fields: { reason: "not-in-set" } });
    }
    expect(
      refusalOf(
        parse(keepInTextInput, {
          bindingId: A_BINDING,
          findingGroups: [{ ...ALWAYS_GROUP, tier: "sometimes" }],
          reason: REASON,
        }),
      ),
    ).toEqual({ word: "malformed", fields: { "findingGroups.0.tier": "not-in-set" } });
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
            bindingId: A_BINDING,
            findingGroups: [ALWAYS_GROUP],
            reason,
          }),
        ),
      ).toEqual({ word: "malformed", fields: { reason: word } });
    }
  });

  it("brands the ids an act is handed", () => {
    const kept = parse(keepInTextInput, {
      bindingId: A_BINDING,
      findingGroups: [ALWAYS_GROUP],
      reason: REASON,
    });

    expect(kept).toEqual({
      ok: true,
      value: { bindingId: A_BINDING, findingGroups: [ALWAYS_GROUP], reason: REASON },
    });
    expect(refusalOf(parse(findingsOfInput, { bindingId: A_FINDING.toLowerCase() }))).toEqual({
      word: "malformed",
      fields: { bindingId: "bad-format" },
    });
  });
});
