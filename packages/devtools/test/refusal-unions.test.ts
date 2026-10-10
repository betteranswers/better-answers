import { describe, expect, it } from "vitest";

import { refusalWordsIn } from "@better-answers/devtools/refusal-unions";

const FILE = "slice.ts";

const wordsIn = (source: string): readonly string[] =>
  refusalWordsIn(FILE, source).map(({ word }) => word);

/** The regex the walk replaced: it read a union only when its text named one of five vocabularies. */
const BUILT_FROM_A_VOCABULARY = /\b(?:Kernel|Member|Source|Workspace|Erasure)Refusal</;

describe("the words a refusal union is built from", () => {
  it("names a word in a union the regex never read", () => {
    const union = `RoleRefusal | "invented-word"`;

    expect(wordsIn(`export type ReadThingRefusal = ${union};\n`)).toEqual(["invented-word"]);
    expect(BUILT_FROM_A_VOCABULARY.test(union)).toBe(false);
  });

  it("names each word once, with its line", () => {
    const source = `type Unused = 1;
export type ReadThingRefusal = MemberRefusal<"no-such-thing">;
`;

    expect(refusalWordsIn(FILE, source)).toEqual([{ word: "no-such-thing", line: 2 }]);
  });

  it("names a vocabulary's argument in an object's word", () => {
    const source = `type AddressRefused = { readonly word: AddressWord; readonly address: string };
type AddressWord = MemberRefusal<"operator-marked">;
type TooBroad = { readonly word: ErasureRefusal<"identifier-too-broad">; readonly said: "x" };
`;

    expect(wordsIn(source)).toEqual(["operator-marked", "identifier-too-broad"]);
  });

  it("names a vocabulary's and an item list's arguments", () => {
    const source = `export type BulkRefusal =
  | MemberRefusal<"role-forbids" | "changed-meanwhile">
  | RefusedItems<MemberRefusal<"last-admin">>
  | Error;
`;

    expect(wordsIn(source)).toEqual(["role-forbids", "changed-meanwhile", "last-admin"]);
  });

  it("reads through parentheses and intersections, never an object's discriminator", () => {
    const source = `export type ImportRefusal =
  | "manifest-taken"
  | ({ readonly kind: "unsound" } & Unsound)
  | { readonly kind: "stopped"; readonly reason: "path-taken" };
`;

    expect(wordsIn(source)).toEqual(["manifest-taken"]);
  });

  it("names no class a `…OfClass` type takes", () => {
    const source = `export type AdmissionRefusal = KernelRefusalOfClass<"forbidden" | "unauthenticated">;\n`;

    expect(wordsIn(source)).toEqual([]);
  });

  it("reads an unexported refusal type, and no other type", () => {
    const source = `type ReplayRefusal = "unreadable-commit";
export type Replayed = "landed" | "skipped";
`;

    expect(wordsIn(source)).toEqual(["unreadable-commit"]);
  });

  it("refuses a source that does not parse, naming its file", () => {
    expect(() => refusalWordsIn(FILE, "export type Refusal = ;\n")).toThrow(/slice\.ts/);
  });
});
