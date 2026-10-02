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
      "console.people.inspect",
      "console.people.list",
      "console.people.namesWaiting",
      "console.people.revokeCredentials",
      "console.workspaces.list",
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
      "members.revokeCredentials",
      "person.acceptInvitation",
      "person.invitation",
      "person.invitations",
      "person.requestAccess",
      "person.setDisplayName",
      "routes.list",
      "runs.ofSubject",
      "session.membership",
      "session.operator",
      "sources.bind",
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
      | "session.membership"
      | "session.operator"
      | "person.setDisplayName"
      | "person.requestAccess"
      | "person.invitation"
      | "person.invitations"
      | "person.acceptInvitation"
      | "console.people.list"
      | "console.people.inspect"
      | "console.people.namesWaiting"
      | "console.people.correctDisplayName"
      | "console.people.revokeCredentials"
      | "console.workspaces.list"
      | "members.list"
      | "members.changeRole"
      | "members.auditLog"
      | "members.activity"
      | "members.invitations"
      | "members.invitationCounts"
      | "members.invite"
      | "members.resendInvitation"
      | "members.bulkResendInvitations"
      | "members.cancelInvitation"
      | "members.bulkCancelInvitations"
      | "members.revokeCredentials"
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
      | "routes.list"
      | "sources.list"
      | "sources.bind"
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

  it("writes the test workspace's mark from the ops command alone", () => {
    expect(filesMatching(API_SOURCE, /\bensureTestWorkspace\b/)).toEqual(["ops/index.ts"]);
    expect(filesMatching(CORE_SOURCE, /\b(?:INSERT INTO|UPDATE) test_workspace_mark\b/)).toEqual([
      "members/test-workspace.ts",
    ]);
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
