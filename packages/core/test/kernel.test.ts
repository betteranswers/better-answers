import { boundarySchemas } from "@better-answers/schema";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  type ActorId,
  actorIdOf,
  attempt,
  isPortablePath,
  type PlatformPrincipal,
  refusalFor,
  requireAdmin,
  type UserPrincipal,
} from "../src/kernel/index.ts";

/**
 * The kernel's vocabulary through the interface every slice reads it by
 * (`@better-answers/core/kernel`, `[TEST1]`): the actor a record names, the word a
 * role-guarded act refuses with, the one `try`/`catch` every slice entry point wraps its
 * external library in, and the reading of a store's constraint names into a slice's own
 * words. All pure — no store, no container.
 */

/** The ids come through the boundary, so the brands are earned rather than asserted. */
const PERSON_ID = "01JQ0000000000000000000PER";
const person = (role: UserPrincipal["role"]): UserPrincipal => ({
  kind: "user",
  workspaceId: boundarySchemas.workspace.select.shape.id.parse("01JQ0000000000000000000WSP"),
  userId: boundarySchemas.user.select.shape.id.parse(PERSON_ID),
  role,
  groups: [],
  credentialIssuedAtMs: Date.now(),
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

/**
 * `attempt` is the one `try`/`catch` in the repository, so what a driver or an SDK raises
 * has to come back as an Error whatever shape it was thrown in — a caller reads `.message`
 * off the value it is handed and has nowhere else to look.
 */
describe("the one try/catch every slice entry point wraps its library in", () => {
  /** The two fields a caller reads off the normalised Error, and whether it is one at all. */
  const errorOfThrown = async (
    thrown: unknown,
  ): Promise<{ isError: boolean; message: string; cause: unknown }> => {
    const answered = await attempt(async () => {
      throw thrown;
    });
    if (answered.ok) throw new Error("attempt answered a value where the operation threw");
    return {
      isError: answered.error instanceof Error,
      message: answered.error.message,
      cause: answered.error.cause,
    };
  };

  it("hands back the driver's own Error, so the class and the fields it carries survive", async () => {
    // `refusalFor` reads `.constraint` off this very object, so the Error a slice sees has
    // to be the one the driver threw and never a copy of its message.
    const thrown = Object.assign(new TypeError("deadlock detected"), {
      constraint: "member_pkey",
    });

    const answered = await attempt(async () => {
      throw thrown;
    });

    expect(answered.ok).toBe(false);
    expect(answered.ok ? undefined : answered.error).toBe(thrown);
  });

  it("turns a thrown string into an Error carrying it as the message", async () => {
    expect(await errorOfThrown("the socket hung up")).toEqual({
      isError: true,
      message: "the socket hung up",
      cause: undefined,
    });
  });

  it("names what was thrown when it is neither an Error nor a string, and keeps it as the cause", async () => {
    const thrown = { code: 42 };

    expect(await errorOfThrown(thrown)).toEqual({
      isError: true,
      message: "non-Error thrown: [object Object]",
      cause: thrown,
    });
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

  it("answers for the constraint that was violated, not one whose name it contains", () => {
    // `member_pkey` is a substring of `member_pkey_v2`, so a search over the text alone
    // would answer the wrong word for whichever the map happened to list first.
    const overlapping = { member_pkey: "one", member_pkey_v2: "the other" } as const;
    const violation = Object.assign(
      new Error('duplicate key value violates unique constraint "member_pkey_v2"'),
      { constraint: "member_pkey_v2" },
    );

    expect(refusalFor(violation, overlapping)).toBe("the other");
  });
});

describe("the shape of a name a store can hand back", () => {
  it("takes a relative name whose every segment is a plain one", () => {
    expect(isPortablePath("knowledge/expenses.md")).toBe(true);
    expect(
      isPortablePath("erasures/01JQ0000000000000000000WSP/01JQ00000000000000000ERQ.json"),
    ).toBe(true);
    // A dot inside a segment is part of a name; only a segment that is nothing but dots is
    // the thing a filesystem reads as a place rather than a name.
    expect(isPortablePath(".hidden/..trailing/a..b")).toBe(true);
  });

  it("refuses a dot segment, wherever in the name it sits", () => {
    expect(isPortablePath(".")).toBe(false);
    expect(isPortablePath("..")).toBe(false);
    expect(isPortablePath("knowledge/./expenses.md")).toBe(false);
    expect(isPortablePath("knowledge/../expenses.md")).toBe(false);
    expect(isPortablePath("knowledge/expenses.md/..")).toBe(false);
  });

  it("refuses a name with nothing to read, an empty segment, or a separator at either end", () => {
    expect(isPortablePath("")).toBe(false);
    expect(isPortablePath("/")).toBe(false);
    expect(isPortablePath("/knowledge/expenses.md")).toBe(false);
    expect(isPortablePath("knowledge//expenses.md")).toBe(false);
    expect(isPortablePath("knowledge/expenses.md/")).toBe(false);
  });

  it("refuses a control character, because a listing would have to quote it", () => {
    expect(isPortablePath("knowledge/expenses\u0000.md")).toBe(false);
    expect(isPortablePath("knowledge/expenses\t.md")).toBe(false);
    expect(isPortablePath("knowledge/expenses\n.md")).toBe(false);
    expect(isPortablePath("knowledge/expenses\u007f.md")).toBe(false);
    // The boundary both ways: 0x1f is refused and 0x20 — a space — is an ordinary character in
    // a name every tool here reads back, so the rule is about control and not about tidiness.
    expect(isPortablePath("knowledge/expenses\u001f.md")).toBe(false);
    expect(isPortablePath("knowledge/travel expenses.md")).toBe(true);
  });

  it("takes a name outside the ASCII range, because a name is text and not bytes", () => {
    expect(isPortablePath("knowledge/dépenses.md")).toBe(true);
    expect(isPortablePath("knowledge/\u{1d11e}.md")).toBe(true);
  });
});
