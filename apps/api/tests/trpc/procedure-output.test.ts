import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import type { AnyProcedure, inferProcedureOutput } from "@trpc/server";
import { describe, expect, expectTypeOf, it } from "vitest";

import type { Result } from "@better-answers/core/kernel";
import { rootsOf } from "@better-answers/schema/testing/roots";

import { appRouter, type AppRouter } from "../../src/trpc/router.ts";

const { repositoryRoot, workspaceRoot } = rootsOf(import.meta.url);

const API_SOURCE = path.join(workspaceRoot, "src/");
const CORE_SOURCE = path.join(repositoryRoot, "packages/core/src/");

const filesMatching = (root: string, pattern: RegExp): readonly string[] =>
  readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".ts"))
    .filter((file) => pattern.test(readFileSync(path.join(root, file), "utf8")))
    .toSorted();

const NAMES_THE_MARK = /test_workspace_mark|testWorkspaceMark/;

const NAMING_THE_MARK_IN_CORE = ["members/invitations/testing-domain.ts"];

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

describe("the outputs of router procedures", () => {
  it("lists every router procedure by its call path", () => {
    expect(Object.keys(appRouter._def.procedures).sort()).toEqual([
      "ask.giveFeedback",
      "ask.question",
      "ask.yourQuestions",
      "ask.yourRecord",
      "console.people.correctDisplayName",
      "console.people.endEverySignInAndToken",
      "console.people.inspect",
      "console.people.list",
      "console.people.namesWaiting",
      "console.workspaces.list",
      "inbox.accept",
      "inbox.decline",
      "inbox.item",
      "inbox.waiting",
      "knowledge.allKnowledge",
      "knowledge.briefCopy",
      "knowledge.collections",
      "knowledge.conceptToEdit",
      "knowledge.conceptTypes",
      "knowledge.conceptsOfType",
      "knowledge.exportBundle",
      "knowledge.exportGuide",
      "knowledge.exportRecords",
      "knowledge.find",
      "knowledge.guide",
      "knowledge.guides",
      "knowledge.includeAvailable",
      "knowledge.nameOwner",
      "knowledge.open",
      "knowledge.recordCopy",
      "knowledge.saveBrief",
      "knowledge.saveConcept",
      "knowledge.setOwners",
      "knowledge.tree",
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
      "person.sessions",
      "person.setDisplayName",
      "person.signOutOtherSessions",
      "person.signOutSession",
      "person.workspaces",
      "questions.asked",
      "questions.closeFlag",
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
      | "person.workspaces"
      | "person.acceptInvitation"
      | "person.secondFactor"
      | "person.sessions"
      | "person.signOutOtherSessions"
      | "person.signOutSession"
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
      | "knowledge.collections"
      | "knowledge.nameOwner"
      | "knowledge.allKnowledge"
      | "knowledge.conceptTypes"
      | "knowledge.setOwners"
      | "knowledge.exportBundle"
      | "knowledge.exportRecords"
      | "knowledge.exportGuide"
      | "knowledge.tree"
      | "knowledge.conceptsOfType"
      | "knowledge.conceptToEdit"
      | "knowledge.saveConcept"
      | "knowledge.guides"
      | "knowledge.guide"
      | "knowledge.saveBrief"
      | "knowledge.includeAvailable"
      | "knowledge.briefCopy"
      | "knowledge.recordCopy"
      | "inbox.waiting"
      | "inbox.item"
      | "inbox.accept"
      | "inbox.decline"
      | "ask.question"
      | "ask.giveFeedback"
      | "ask.yourQuestions"
      | "ask.yourRecord"
      | "questions.asked"
      | "questions.closeFlag"
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

  it("mentions the test workspace mark only in testing-domain.ts", () => {
    expect(filesMatching(API_SOURCE, NAMES_THE_MARK)).toEqual([]);
    expect(filesMatching(CORE_SOURCE, NAMES_THE_MARK)).toEqual(NAMING_THE_MARK_IN_CORE);
  });

  it("returns no Result from any procedure, so refusals stay errors", () => {
    expectTypeOf<PathsAnsweringAResult<EveryProcedure>>().toEqualTypeOf<"none">();
  });

  it("reports the path of a procedure that returns a Result", () => {
    expectTypeOf<
      PathsAnsweringAResult<Leaf<"sources.narrow", Result<string, "no-such-binding">>>
    >().toEqualTypeOf<"sources.narrow">();
  });
});
