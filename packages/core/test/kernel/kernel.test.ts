import { assert, describe, expect, expectTypeOf, it } from "vitest";

import { boundarySchemas } from "@better-answers/schema";

import {
  type ActorId,
  actorIdOf,
  attempt,
  attemptResult,
  err,
  isPortablePath,
  ok,
  type PlatformPrincipal,
  refusalFor,
  type Result,
  type UserPrincipal,
} from "../../src/kernel/index.ts";

const PERSON_ID = "01JQ0000000000000000000PER";
const person = (role: UserPrincipal["role"]): UserPrincipal => ({
  kind: "user",
  workspaceId: boundarySchemas.workspace.select.shape.id.parse("01JQ0000000000000000000WSP"),
  userId: boundarySchemas.user.select.shape.id.parse(PERSON_ID),
  role,
  groups: [],
  credentialIssuedAtMs: Date.now(),
  secondFactorConfirmedAtMs: Date.now(),
});

const bootstrap: PlatformPrincipal = {
  kind: "platform",
  actorId: "process:better-answers-bootstrap",
};

describe("the actor id a record stores", () => {
  it("names a person by their person id, never an email", () => {
    expect(actorIdOf(person("Editor"))).toBe("human:01JQ0000000000000000000PER");
  });

  it("names the platform by its own actor id", () => {
    expect(actorIdOf(bootstrap)).toBe("process:better-answers-bootstrap");
  });

  it("rejects a plain string typed as an actor id", () => {
    expectTypeOf<string>().not.toExtend<ActorId>();
    expectTypeOf<"human:01JQ">().toExtend<ActorId>();
    expectTypeOf<"process:better-answers-erasure">().toExtend<ActorId>();
    expectTypeOf<"better-answers-import/1.2">().toExtend<ActorId>();

    // @ts-expect-error — an email string is not an actor id.
    const composed: ActorId = "priya@example.com";
    expect(composed).toBe("priya@example.com");
  });
});

describe("attempt, the try/catch around each slice's library calls", () => {
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

  it("returns the driver's thrown Error object unchanged", async () => {
    const thrown = Object.assign(new TypeError("deadlock detected"), {
      constraint: "member_pkey",
    });

    const answered = await attempt(async () => {
      throw thrown;
    });

    assert(!answered.ok);
    expect(answered.error).toBe(thrown);
  });

  it("turns a thrown string into an Error with that message", async () => {
    expect(await errorOfThrown("the socket hung up")).toEqual({
      isError: true,
      message: "the socket hung up",
      cause: undefined,
    });
  });

  it("wraps any other thrown value, keeping it as the cause", async () => {
    const thrown = { code: 42 };

    expect(await errorOfThrown(thrown)).toEqual({
      isError: true,
      message: "non-Error thrown: [object Object]",
      cause: thrown,
    });
  });
});

describe("attemptResult, for an operation that returns a Result", () => {
  it("returns the operation's value unchanged", async () => {
    expect(await attemptResult(async () => ok("landed"))).toEqual({ ok: true, value: "landed" });
  });

  it("returns the operation's refusal unchanged", async () => {
    expect(await attemptResult(async () => err("rename-refused"))).toEqual({
      ok: false,
      error: "rename-refused",
    });
  });

  it("returns a rejection as an Error alongside the refusal types", async () => {
    const answered = await attemptResult(async (): Promise<Result<string, "held">> => {
      // oxlint-disable-next-line typescript/only-throw-error -- the test throws a non-Error to prove attemptResult normalises it
      throw "the socket hung up";
    });

    expectTypeOf(answered).toEqualTypeOf<Result<string, "held" | Error>>();
    assert(!answered.ok);
    expect(answered.error).toEqual(new Error("the socket hung up"));
  });
});

describe("refusalFor, mapping a store's constraint names to refusal words", () => {
  const named = { workspace_short_name_unique: "slug-taken" } as const;

  it("returns the mapped refusal word for the error's constraint", () => {
    const violation = Object.assign(new Error("duplicate key value violates unique constraint"), {
      constraint: "workspace_short_name_unique",
    });

    expect(refusalFor(violation, named)).toBe("slug-taken");
  });

  it("falls back to the constraint named in the error message", () => {
    const violation = new Error(
      'duplicate key value violates unique constraint "workspace_short_name_unique"',
    );

    expect(refusalFor(violation, named)).toBe("slug-taken");
  });

  it("returns the store's error for an unmapped constraint", () => {
    const failure = Object.assign(new Error("deadlock detected"), { constraint: "member_pkey" });

    expect(refusalFor(failure, named)).toBe(failure);
  });

  it("matches the whole constraint name, not a name inside it", () => {
    const overlapping = { member_pkey: "one", member_pkey_v2: "the other" } as const;
    const violation = Object.assign(
      new Error('duplicate key value violates unique constraint "member_pkey_v2"'),
      { constraint: "member_pkey_v2" },
    );

    expect(refusalFor(violation, overlapping)).toBe("the other");
  });
});

describe("isPortablePath, the path shape a store accepts", () => {
  it("accepts a relative path of plain segments", () => {
    expect(isPortablePath("knowledge/expenses.md")).toBe(true);
    expect(
      isPortablePath("erasures/01JQ0000000000000000000WSP/01JQ00000000000000000ERQ.json"),
    ).toBe(true);

    expect(isPortablePath(".hidden/..trailing/a..b")).toBe(true);
  });

  it("rejects a . or .. segment anywhere in the path", () => {
    expect(isPortablePath(".")).toBe(false);
    expect(isPortablePath("..")).toBe(false);
    expect(isPortablePath("knowledge/./expenses.md")).toBe(false);
    expect(isPortablePath("knowledge/../expenses.md")).toBe(false);
    expect(isPortablePath("knowledge/expenses.md/..")).toBe(false);
  });

  it("rejects empty paths, empty segments, and leading or trailing slashes", () => {
    expect(isPortablePath("")).toBe(false);
    expect(isPortablePath("/")).toBe(false);
    expect(isPortablePath("/knowledge/expenses.md")).toBe(false);
    expect(isPortablePath("knowledge//expenses.md")).toBe(false);
    expect(isPortablePath("knowledge/expenses.md/")).toBe(false);
  });

  it("rejects a control character but accepts a space", () => {
    expect(isPortablePath("knowledge/expenses\u0000.md")).toBe(false);
    expect(isPortablePath("knowledge/expenses\t.md")).toBe(false);
    expect(isPortablePath("knowledge/expenses\n.md")).toBe(false);
    expect(isPortablePath("knowledge/expenses\u007f.md")).toBe(false);

    expect(isPortablePath("knowledge/expenses\u001f.md")).toBe(false);
    expect(isPortablePath("knowledge/travel expenses.md")).toBe(true);
  });

  it("accepts non-ASCII characters", () => {
    expect(isPortablePath("knowledge/dépenses.md")).toBe(true);
    expect(isPortablePath("knowledge/\u{1d11e}.md")).toBe(true);
  });
});
