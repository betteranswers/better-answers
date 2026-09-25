import { readFileSync } from "node:fs";

import { describe, expect, expectTypeOf, it } from "vitest";

import { declareRefusals, REFUSAL_CLASSES, refusalRegister } from "../src/kernel/index.ts";
import type { BindUploadRefusal, SourceRefusal } from "../src/sources/index.ts";
import type {
  AddMemberRefusal,
  ProvisionRefusal,
  SetDisplayNameRefusal,
} from "../src/workspaces/index.ts";
import { loadEveryEntryPoint } from "./entry-points.ts";
import { coreSourceFiles, sourceTreeIsInstrumented } from "./source-tree.ts";

const SEVEN_CLASSES = [
  "unauthenticated",
  "forbidden",
  "absent",
  "malformed",
  "inapplicable",
  "conflict",
  "precondition",
];

const REGISTER = {
  malformed: "malformed by kernel",
  "role-forbids": "forbidden by kernel",
  "not-found": "absent by kernel",
  "not-a-member": "unauthenticated by kernel",
  "credentials-revoked": "unauthenticated by kernel",
  "role-disagrees": "unauthenticated by kernel",
  "role-unknown": "unauthenticated by kernel",
  "malformed-claims": "unauthenticated by kernel",
  "envelope-version-unknown": "inapplicable by kernel",
  "envelope-malformed": "malformed by kernel",
  "envelope-not-authentic": "malformed by kernel",

  "no-such-binding": "absent by sources",
  "no-such-document": "absent by sources",
  "no-such-finding": "absent by sources",
  "already-published": "conflict by sources",
  "not-indexed": "precondition by sources",
  "confirmation-missing": "precondition by sources",
  "special-category-unreviewed": "precondition by sources",
  "media-type-refused": "inapplicable by sources",
  "too-large": "inapplicable by sources",
  "not-the-always-set": "inapplicable by sources",
  "not-special-category": "inapplicable by sources",
  "widening-refused": "inapplicable by sources",
  "not-wider": "inapplicable by sources",

  "no-such-group": "absent by members",
  "no-such-member": "absent by members",
  "not-in-group": "absent by members",
  "name-taken": "conflict by members",
  "already-in-group": "conflict by members",

  "no-such-user": "absent by workspaces",
  "no-such-workspace": "absent by workspaces",
  "workspace-gone": "unauthenticated by workspaces",
  "person-gone": "unauthenticated by workspaces",
  "slug-taken": "conflict by workspaces",
  "workspace-exists": "conflict by workspaces",
  "already-a-member": "conflict by workspaces",
  "no-display-name": "precondition by workspaces",
  "display-name-empty": "malformed by workspaces",
  "display-name-not-one-line": "malformed by workspaces",
  "display-name-control-character": "malformed by workspaces",
  "display-name-angle-bracket": "malformed by workspaces",
  "display-name-too-long": "malformed by workspaces",

  "identifier-too-broad": "inapplicable by erasure",
};

type EveryRegisteredWord = keyof typeof REGISTER;

const ALIAS = /\btype \w+ =([^;]*);/g;
const BUILT_FROM_A_VOCABULARY = /\b(?:Kernel|Member|Source|Workspace|Erasure)Refusal</;
const QUOTED = /"([a-z][a-z0-9-]*)"/g;

const wordsInConvertedUnions = (files: readonly string[]): ReadonlySet<string> => {
  const named = new Set<string>();
  for (const file of files) {
    for (const alias of readFileSync(file, "utf8").matchAll(ALIAS)) {
      const union = alias[1] ?? "";
      if (!BUILT_FROM_A_VOCABULARY.test(union)) continue;
      for (const word of union.matchAll(QUOTED)) named.add(word[1] ?? "");
    }
  }
  return named;
};

const registerAsRead = (): Readonly<Record<string, string>> =>
  Object.fromEntries(
    refusalRegister().map(({ word, class: held, owner }) => [word, `${held} by ${owner}`]),
  );

describe("the refusal-word walk", () => {
  it("classes a word in one of seven classes", () => {
    expect([...REFUSAL_CLASSES]).toEqual(SEVEN_CLASSES);
  });

  it("holds one class and declaring slice for every union word", async () => {
    await loadEveryEntryPoint();

    expect(registerAsRead()).toEqual(REGISTER);
  });

  it.skipIf(sourceTreeIsInstrumented())(
    "matches the register and the acts' union words both ways",
    async () => {
      await loadEveryEntryPoint();
      const held = new Set(Object.keys(registerAsRead()));
      const named = wordsInConvertedUnions(coreSourceFiles());

      expect([...held].filter((word) => !named.has(word))).toEqual([]);
      expect([...named].filter((word) => !held.has(word))).toEqual([]);
      expect(named.size).toBeGreaterThan(0);
    },
  );

  it("refuses a second declaration of a registered word", async () => {
    await loadEveryEntryPoint();

    expect(() => declareRefusals("sources", { "no-such-binding": "absent" })).toThrow(
      /no-such-binding is declared twice/,
    );
  });

  it("refuses a word that is not lower case and hyphenated", () => {
    expect(() => declareRefusals("sources", { NoSuchThing: "absent" })).toThrow(
      /NoSuchThing is not a refusal word/,
    );
  });

  it("builds a union from a registered word and no other", () => {
    expectTypeOf<SourceRefusal<"no-such-binding">>().toEqualTypeOf<"no-such-binding">();
    // @ts-expect-error — a word no slice declared is no refusal word.
    expectTypeOf<SourceRefusal<"no-such-thing">>().toBeString();
    // @ts-expect-error — a store door's own word is a defect, never a refusal.
    expectTypeOf<SourceRefusal<"no-bucket">>().toBeString();
  });

  it("answers an act's union in registered words alone", () => {
    expectTypeOf<BindUploadRefusal>().toExtend<EveryRegisteredWord | Error>();
    expectTypeOf<ProvisionRefusal>().toExtend<EveryRegisteredWord>();
    expectTypeOf<AddMemberRefusal>().toExtend<EveryRegisteredWord>();
    expectTypeOf<SetDisplayNameRefusal>().toExtend<EveryRegisteredWord>();
    expectTypeOf<SourceRefusal<"no-such-binding"> | "invented">().not.toExtend<
      EveryRegisteredWord | Error
    >();
  });
});
