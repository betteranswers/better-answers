import { boundarySchemas } from "@better-answers/schema";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  type ActorId,
  actorIdOf,
  type PlatformPrincipal,
  refusalFor,
  requireAdmin,
  type UserPrincipal,
} from "../src/kernel/index.ts";

/**
 * The kernel's vocabulary through the interface every slice reads it by
 * (`@better-answers/core/kernel`, `[TEST1]`): the actor a record names, the word a
 * role-guarded act refuses with, and the reading of a store's constraint names into a
 * slice's own words. All pure — no store, no container.
 */

/** The ids come through the boundary, so the brands are earned rather than asserted. */
const PERSON_ID = "01JQ0000000000000000000PER";
const person = (role: UserPrincipal["role"]): UserPrincipal => ({
  kind: "user",
  workspaceId: boundarySchemas.workspace.select.shape.id.parse("01JQ0000000000000000000WSP"),
  userId: boundarySchemas.user.select.shape.id.parse(PERSON_ID),
  role,
  groups: [],
});

const bootstrap: PlatformPrincipal = {
  kind: "platform",
  actorId: "process:better-answers-bootstrap",
};

describe("the actor a record names", () => {
  it("names a person by their person id, so no record carries an email", () => {
    expect(actorIdOf(person("Editor"))).toBe("human:01JQ0000000000000000000PER");
  });

  it("names the platform by its own actor id, never by a person", () => {
    expect(actorIdOf(bootstrap)).toBe("process:better-answers-bootstrap");
  });

  it("refuses a bare string where an actor id belongs, so none can be composed by hand", () => {
    expectTypeOf<string>().not.toExtend<ActorId>();
    expectTypeOf<"human:01JQ">().toExtend<ActorId>();
    expectTypeOf<"process:better-answers-erasure">().toExtend<ActorId>();
    expectTypeOf<"better-answers-import/1.2">().toExtend<ActorId>();
    // A hand-composed string is not an actor id: only the kernel's own forms are.
    // @ts-expect-error — the shape is the guarantee `[AUDIT3]` rests on.
    const composed: ActorId = "priya@example.com";
    expect(composed).toBe("priya@example.com");
  });
});

describe("the guard on an act only an Admin may perform", () => {
  it("lets an Admin through, carrying the role the act may rely on", () => {
    const admin = person("Admin");
    const guarded = requireAdmin(admin);

    expect(guarded).toEqual({ ok: true, value: admin });
    if (guarded.ok) expectTypeOf(guarded.value.role).toEqualTypeOf<"Admin">();
  });

  it("refuses an Editor with the one word every role-guarded act refuses with", () => {
    expect(requireAdmin(person("Editor"))).toEqual({ ok: false, error: "role-forbids" });
  });

  it("refuses a Viewer with that same word, so the two read alike to a caller", () => {
    expect(requireAdmin(person("Viewer"))).toEqual({ ok: false, error: "role-forbids" });
  });
});

describe("reading a store's constraint names into a slice's words", () => {
  const named = { workspace_slug_unique: "slug-taken" } as const;

  it("answers the refusal word a caller can act on when the map names the constraint", () => {
    const violation = Object.assign(new Error("duplicate key value violates unique constraint"), {
      constraint: "workspace_slug_unique",
    });

    expect(refusalFor(violation, named)).toBe("slug-taken");
  });

  it("reads the constraint out of the message when the driver put it nowhere else", () => {
    const violation = new Error(
      'duplicate key value violates unique constraint "workspace_slug_unique"',
    );

    expect(refusalFor(violation, named)).toBe("slug-taken");
  });

  it("hands back the store's own error when the map names no constraint of it", () => {
    const failure = Object.assign(new Error("deadlock detected"), { constraint: "member_pkey" });

    expect(refusalFor(failure, named)).toBe(failure);
  });
});
