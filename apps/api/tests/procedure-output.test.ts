import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { AnyProcedure, inferProcedureOutput } from "@trpc/server";
import { describe, expect, expectTypeOf, it } from "vitest";

import type { Result } from "@better-answers/core/kernel";

import { appRouter, type AppRouter } from "../src/trpc/router.ts";

const API_SOURCE = fileURLToPath(new URL("../src/", import.meta.url));
const CORE_SOURCE = fileURLToPath(new URL("../../../packages/core/src/", import.meta.url));

/** Each TypeScript file under `root` whose text matches, by its path from `root`. */
const filesMatching = (root: string, pattern: RegExp): readonly string[] =>
  readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".ts"))
    .filter((file) => pattern.test(readFileSync(path.join(root, file), "utf8")))
    .toSorted();

/** Any mention, read or write, raw or through the schema, so a new one is a reviewed change. */
const NAMES_THE_MARK = /test_workspace_mark|testWorkspaceMark/;

const NAMING_THE_MARK_IN_CORE = [
  // The fixture, the mark's one writer, which reads it first to keep or correct it.
  "members/test-workspace.ts",
  // The invitation guard, which only reads it.
  "members/testing-domain.ts",
];

type Leaf<Path extends string, Output> = { readonly path: Path; readonly output: Output };

type LeavesOf<Node, Here extends string> = Node extends AnyProcedure
  ? Leaf<Here, inferProcedureOutput<Node>>
  : {
      readonly [Key in keyof Node & string]: LeavesOf<
        Node[Key],
        Here extends "" ? Key : `${Here}.${Key}`
      >;
    }[keyof Node & string];

type EveryProcedure = LeavesOf<AppRouter["_def"]["procedures"], "">;

type ResultAnswering<Leaves> = Extract<Leaves, Leaf<string, { readonly ok: boolean }>>;

type PathsAnsweringAResult<Leaves> = [ResultAnswering<Leaves>] extends [never]
  ? "none"
  : ResultAnswering<Leaves>["path"];

describe("what a procedure may answer the wire", () => {
  it("reaches every router procedure by the path its caller names", () => {
    expect(Object.keys(appRouter._def.procedures).sort()).toEqual([
      "console.people.correctDisplayName",
      "console.people.endEverySignInAndToken",
      "console.people.inspect",
      "console.people.list",
      "console.people.namesWaiting",
      "console.workspaces.list",
      "knowledge.find",
      "knowledge.open",
      "members.activity",
      "members.addToGroup",
      "members.approveRequest",
      "members.auditLog",
      "members.bulkAddToGroup",
      "members.bulkCancelInvitations",
      "members.bulkChangeRole",
      "members.bulkRemove",
      "members.bulkResendInvitations",
      "members.cancelInvitation",
      "members.changeRole",
      "members.createGroup",
      "members.declineRequest",
      "members.deleteGroup",
      "members.endEverySignInAndToken",
      "members.exportAuditLog",
      "members.flagDisplayName",
      "members.groups",
      "members.invitationCounts",
      "members.invitations",
      "members.invite",
      "members.list",
      "members.remove",
      "members.removeFromGroup",
      "members.renameGroup",
      "members.requests",
      "members.resendInvitation",
      "modelChoices.list",
      "person.acceptInvitation",
      "person.acknowledgeRecoveryCodes",
      "person.dismissPasskeyOffer",
      "person.invitation",
      "person.invitations",
      "person.removeAuthenticator",
      "person.removePasskey",
      "person.renamePasskey",
      "person.replaceRecoveryCodes",
      "person.requestAccess",
      "person.secondFactor",
      "person.setDisplayName",
      "runs.ofSubject",
      "session.member",
      "session.operator",
      "sources.connect",
      "sources.dismissAsNotSpecialCategory",
      "sources.findings",
      "sources.keepInText",
      "sources.list",
      "sources.narrow",
      "sources.narrowDocuments",
      "sources.preview",
      "sources.publish",
      "sources.widen",
    ]);
    expectTypeOf<EveryProcedure["path"]>().toEqualTypeOf<
      | "session.member"
      | "session.operator"
      | "person.setDisplayName"
      | "person.requestAccess"
      | "person.invitation"
      | "person.invitations"
      | "person.acceptInvitation"
      | "person.secondFactor"
      | "person.renamePasskey"
      | "person.removePasskey"
      | "person.dismissPasskeyOffer"
      | "person.removeAuthenticator"
      | "person.replaceRecoveryCodes"
      | "person.acknowledgeRecoveryCodes"
      | "console.people.list"
      | "console.people.inspect"
      | "console.people.namesWaiting"
      | "console.people.correctDisplayName"
      | "console.people.endEverySignInAndToken"
      | "console.workspaces.list"
      | "members.list"
      | "members.changeRole"
      | "members.auditLog"
      | "members.activity"
      | "members.exportAuditLog"
      | "members.invitations"
      | "members.invitationCounts"
      | "members.invite"
      | "members.resendInvitation"
      | "members.bulkResendInvitations"
      | "members.cancelInvitation"
      | "members.bulkCancelInvitations"
      | "members.endEverySignInAndToken"
      | "members.remove"
      | "members.bulkChangeRole"
      | "members.bulkRemove"
      | "members.bulkAddToGroup"
      | "members.flagDisplayName"
      | "members.groups"
      | "members.createGroup"
      | "members.renameGroup"
      | "members.deleteGroup"
      | "members.addToGroup"
      | "members.removeFromGroup"
      | "members.requests"
      | "members.approveRequest"
      | "members.declineRequest"
      | "knowledge.find"
      | "knowledge.open"
      | "modelChoices.list"
      | "sources.list"
      | "sources.connect"
      | "sources.findings"
      | "sources.keepInText"
      | "sources.narrowDocuments"
      | "sources.dismissAsNotSpecialCategory"
      | "sources.publish"
      | "sources.narrow"
      | "sources.widen"
      | "sources.preview"
      | "runs.ofSubject"
    >();
  });

  it("names the mark only in the fixture and the guard", () => {
    expect(filesMatching(API_SOURCE, /\bensureTestWorkspace\b/)).toEqual(["ops/index.ts"]);
    expect(filesMatching(API_SOURCE, NAMES_THE_MARK)).toEqual([]);
    expect(filesMatching(CORE_SOURCE, NAMES_THE_MARK)).toEqual(NAMING_THE_MARK_IN_CORE);
  });

  it("answers no Result, which would cross a refusal as success", () => {
    expectTypeOf<PathsAnsweringAResult<EveryProcedure>>().toEqualTypeOf<"none">();
  });

  it("names the procedure that answered one, by its path", () => {
    expectTypeOf<
      PathsAnsweringAResult<Leaf<"sources.narrow", Result<string, "no-such-binding">>>
    >().toEqualTypeOf<"sources.narrow">();
  });
});
