import { readFileSync } from "node:fs";

import { describe, expect, expectTypeOf, it } from "vitest";

import { refusalWordsIn } from "@better-answers/devtools/refusal-unions";

import type {
  AcceptSuggestionRefusal,
  ImportBundleRefusal,
  WriteConceptRefusal,
} from "../src/concepts/index.ts";
import {
  classesIn,
  REFUSAL_CLASSES,
  refusalsIn,
  type RefusedItems,
  type WordIn,
} from "../src/kernel/index.ts";
import type {
  AcceptInvitationRefusal,
  ApproveRefusal,
  BulkAddToGroupRefusal,
  BulkCancelInvitationsRefusal,
  BulkChangeRoleRefusal,
  BulkRemoveMembersRefusal,
  BulkResendInvitationsRefusal,
  CancelInvitationRefusal,
  ChangeRoleRefusal,
  DecideRefusal,
  InviteMembersRefusal,
  ListInvitationsRefusal,
  MemberRefusal,
  RemoveMemberRefusal,
  RequestAccessRefusal,
  ResendInvitationRefusal,
  EndEverySignInAndTokenHereRefusal,
  TestWorkspaceRefusal,
} from "../src/members/index.ts";
import { REFUSAL_CATALOGUE } from "../src/refusals/index.ts";
import type { ConnectUploadRefusal, SourceRefusal } from "../src/sources/index.ts";
import type { CommitRefusal } from "../src/store/git/index.ts";
import type {
  AddMemberRefusal,
  AddPersonRefusal,
  ProvisionRefusal,
  SetDisplayNameRefusal,
} from "../src/workspaces/index.ts";
import { asSliceRelative, coreSourceFiles, sourceTreeIsInstrumented } from "./source-tree.ts";

const SEVEN_CLASSES = [
  "unauthenticated",
  "forbidden",
  "absent",
  "malformed",
  "inapplicable",
  "conflict",
  "precondition",
];

const CATALOGUED = {
  malformed: "malformed by kernel",
  "role-forbids": "forbidden by kernel",
  "not-found": "absent by kernel",
  "not-the-operator": "forbidden by kernel",
  "sign-in-too-old": "unauthenticated by kernel",
  "second-factor-pending": "precondition by kernel",
  "changed-meanwhile": "conflict by kernel",
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
  "no-such-request": "absent by members",
  "no-such-role": "absent by members",
  "already-decided": "conflict by members",
  "last-admin": "precondition by members",
  "no-such-invitation": "absent by members",
  "invitation-expired": "precondition by members",
  "invitation-for-another-address": "forbidden by members",
  "off-testing-domain": "inapplicable by members",
  "operator-marked": "inapplicable by members",
  "member-elsewhere": "inapplicable by members",

  "no-such-user": "absent by workspaces",
  "no-such-workspace": "absent by workspaces",
  "workspace-gone": "unauthenticated by workspaces",
  "person-gone": "unauthenticated by workspaces",
  "session-gone": "unauthenticated by workspaces",
  "slug-taken": "conflict by workspaces",
  "workspace-exists": "conflict by workspaces",
  "already-a-member": "conflict by workspaces",
  "person-exists": "conflict by workspaces",
  "no-display-name": "precondition by workspaces",
  "display-name-empty": "malformed by workspaces",
  "display-name-not-one-line": "malformed by workspaces",
  "display-name-control-character": "malformed by workspaces",
  "display-name-angle-bracket": "malformed by workspaces",
  "display-name-too-long": "malformed by workspaces",
  "no-authenticator": "absent by workspaces",
  "no-passkey": "absent by workspaces",
  "recovery-code-wrong": "absent by workspaces",
  "restore-code-wrong": "absent by workspaces",
  "passkey-not-yours": "forbidden by workspaces",
  "setup-not-granted": "precondition by workspaces",
  "restore-code-needed": "precondition by workspaces",
  "passkey-name-empty": "malformed by workspaces",
  "passkey-name-too-long": "malformed by workspaces",
  "recovery-codes-held": "conflict by workspaces",
  "last-second-factor": "precondition by workspaces",

  "identifier-too-broad": "inapplicable by erasure",
  "not-an-erasure": "inapplicable by erasure",
  "not-seeded": "precondition by erasure",
  "no-address": "precondition by erasure",

  "no-such-concept": "absent by concepts",
  "no-such-suggestion": "absent by concepts",
  "path-taken": "conflict by concepts",
  "merge-key-taken": "conflict by concepts",
  "manifest-taken": "conflict by concepts",
  "resolution-moved": "conflict by concepts",
  "kind-forbids": "forbidden by concepts",
  "class-unreadable": "forbidden by concepts",
  "rename-refused": "inapplicable by concepts",
  "reclassification-refused": "inapplicable by concepts",
  "unreadable-commit": "inapplicable by concepts",
  "no-such-repository": "precondition by concepts",
  "history-diverged": "precondition by concepts",
  "stale-precondition": "conflict by concepts",
  "malformed-path": "malformed by concepts",
  "malformed-message": "malformed by concepts",

  "no-such-job": "absent by runs",
};

type EveryCataloguedWord = WordIn<typeof REFUSAL_CATALOGUE>;

/** A store door's word is a defect its slice maps or passes on, never a refusal. */
const inASlice = (file: string): boolean =>
  !(asSliceRelative([file])[0] ?? "").startsWith("store/");

const wordsInRefusalUnions = (files: readonly string[]): ReadonlySet<string> =>
  new Set(
    files
      .filter(inASlice)
      .flatMap((file) => refusalWordsIn(file, readFileSync(file, "utf8")))
      .map(({ word }) => word),
  );

const catalogueAsRead = (): Readonly<Record<string, string>> =>
  Object.fromEntries(
    refusalsIn(REFUSAL_CATALOGUE).map(({ word, class: held, owner }) => [
      word,
      `${held} by ${owner}`,
    ]),
  );

describe("the refusal-word walk", () => {
  it("classes a word in one of seven classes", () => {
    expect([...REFUSAL_CLASSES]).toEqual(SEVEN_CLASSES);
  });

  it("holds one class and declaring slice for every union word", () => {
    expect(catalogueAsRead()).toEqual(CATALOGUED);
  });

  it("answers every word's class under one record", () => {
    const classes = Object.fromEntries(
      Object.entries(CATALOGUED).map(([word, said]) => [word, said.split(" by ")[0]]),
    );

    expect(classesIn(REFUSAL_CATALOGUE)).toEqual(classes);
  });

  it.skipIf(sourceTreeIsInstrumented())(
    "matches the catalogue and every refusal union's words both ways",
    () => {
      const held = new Set(Object.keys(catalogueAsRead()));
      const named = wordsInRefusalUnions(coreSourceFiles());

      expect([...held].filter((word) => !named.has(word))).toEqual([]);
      expect([...named].filter((word) => !held.has(word))).toEqual([]);
      expect(named.size).toBeGreaterThan(0);
    },
  );

  it("refuses a word a second owner declares, naming both", () => {
    const restated = { ...REFUSAL_CATALOGUE, transport: { "no-such-binding": "absent" } } as const;

    expect(() => refusalsIn(restated)).toThrow(
      "refusal: no-such-binding is declared twice, by sources and by transport",
    );
  });

  it("refuses a word that is not lower case and hyphenated", () => {
    expect(() => refusalsIn({ sources: { NoSuchThing: "absent" } })).toThrow(
      "refusal: NoSuchThing is not a refusal word, which is lower case and hyphenated",
    );
  });

  it("builds a union from a declared word and no other", () => {
    expectTypeOf<SourceRefusal<"no-such-binding">>().toEqualTypeOf<"no-such-binding">();
    // @ts-expect-error — a word no slice declared is no refusal word.
    expectTypeOf<SourceRefusal<"no-such-thing">>().toBeString();
    // @ts-expect-error — a store door's own word is a defect, never a refusal.
    expectTypeOf<SourceRefusal<"no-bucket">>().toBeString();
  });

  it("answers an action's union in catalogued words alone", () => {
    expectTypeOf<ConnectUploadRefusal>().toExtend<EveryCataloguedWord | Error>();
    expectTypeOf<ProvisionRefusal>().toExtend<EveryCataloguedWord>();
    expectTypeOf<AddMemberRefusal>().toExtend<EveryCataloguedWord>();
    expectTypeOf<AddPersonRefusal>().toExtend<EveryCataloguedWord>();
    expectTypeOf<SetDisplayNameRefusal>().toExtend<EveryCataloguedWord>();
    expectTypeOf<RequestAccessRefusal>().toExtend<EveryCataloguedWord>();
    expectTypeOf<DecideRefusal>().toExtend<EveryCataloguedWord>();
    expectTypeOf<ApproveRefusal>().toExtend<EveryCataloguedWord>();
    expectTypeOf<ChangeRoleRefusal>().toExtend<EveryCataloguedWord | Error>();
    expectTypeOf<ResendInvitationRefusal>().toExtend<EveryCataloguedWord | Error>();
    expectTypeOf<CancelInvitationRefusal>().toExtend<EveryCataloguedWord | Error>();
    expectTypeOf<ListInvitationsRefusal>().toExtend<EveryCataloguedWord | Error>();
    expectTypeOf<EndEverySignInAndTokenHereRefusal>().toExtend<EveryCataloguedWord | Error>();
    expectTypeOf<RemoveMemberRefusal>().toExtend<EveryCataloguedWord | Error>();
    expectTypeOf<AcceptInvitationRefusal>().toExtend<EveryCataloguedWord>();
    type AddressRefused = Extract<TestWorkspaceRefusal, { readonly address: string }>;
    expectTypeOf<AddressRefused["word"]>().toExtend<EveryCataloguedWord>();
    expectTypeOf<Exclude<TestWorkspaceRefusal, AddressRefused>>().toExtend<
      EveryCataloguedWord | Error
    >();
    expectTypeOf<SourceRefusal<"no-such-binding"> | "invented">().not.toExtend<
      EveryCataloguedWord | Error
    >();
  });

  it("classes every word the git door's commit answers", () => {
    expectTypeOf<CommitRefusal>().toExtend<WriteConceptRefusal>();
    expectTypeOf<CommitRefusal>().toExtend<EveryCataloguedWord>();
    expectTypeOf<WriteConceptRefusal>().toExtend<EveryCataloguedWord>();
    expectTypeOf<AcceptSuggestionRefusal>().toExtend<EveryCataloguedWord>();
    expectTypeOf<Extract<ImportBundleRefusal, string>>().toExtend<EveryCataloguedWord>();
    expectTypeOf<CommitRefusal | "invented">().not.toExtend<EveryCataloguedWord>();
  });

  it("names each refused item in a catalogued word alone", () => {
    expectTypeOf<RefusedItems<MemberRefusal<"last-admin" | "no-such-member">>>().toEqualTypeOf<{
      readonly word: "last-admin" | "no-such-member";
      readonly items: Readonly<Record<string, "last-admin" | "no-such-member">>;
    }>();
    expectTypeOf<RefusedItems<MemberRefusal<"last-admin">>>().toExtend<{
      readonly word: EveryCataloguedWord;
      readonly items: Readonly<Record<string, EveryCataloguedWord>>;
    }>();
    // @ts-expect-error — an item's word must be a word some slice declared.
    expectTypeOf<RefusedItems<MemberRefusal<"no-such-thing">>>().toBeObject();
  });

  it("answers a bulk action's items in catalogued words alone", () => {
    type Answered = EveryCataloguedWord | RefusedItems<EveryCataloguedWord> | Error;
    expectTypeOf<BulkChangeRoleRefusal>().toExtend<Answered>();
    expectTypeOf<BulkRemoveMembersRefusal>().toExtend<Answered>();
    expectTypeOf<BulkAddToGroupRefusal>().toExtend<Answered>();
    expectTypeOf<InviteMembersRefusal>().toExtend<Answered>();
    expectTypeOf<BulkResendInvitationsRefusal>().toExtend<Answered>();
    expectTypeOf<BulkCancelInvitationsRefusal>().toExtend<Answered>();
    expectTypeOf<RefusedItems<"invented">>().not.toExtend<Answered>();
  });
});
