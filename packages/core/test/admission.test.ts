import { boundarySchemas } from "@better-answers/schema";
import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";

import {
  admit,
  declareAct,
  EVERY_PURPOSE,
  refusalRegister,
  type AdmissionRefusal,
  type AdmittedOf,
  type InputOf,
  type PlatformPrincipal,
  type RefusalOf,
  type Role,
  type UserPrincipal,
} from "../src/kernel/index.ts";
import { enqueueJobAct, enqueueJobInput } from "../src/runs/index.ts";
import {
  reprocessBindingAct,
  reprocessBindingInput,
  type adminOnBinding,
  type dpiaInputFor,
  type previewChunks,
  type publishBinding,
  type reprocessBinding,
  type ReprocessBindingInput,
  type ReprocessBindingRefusal,
} from "../src/sources/index.ts";

const person = (role: Role): UserPrincipal => ({
  kind: "user",
  workspaceId: boundarySchemas.workspace.select.shape.id.parse("01JQ0000000000000000000WSP"),
  userId: boundarySchemas.user.select.shape.id.parse("01JQ0000000000000000000PER"),
  role,
  groups: [],
  credentialIssuedAtMs: Date.now(),
});

const processActor = (purpose: string): PlatformPrincipal => ({
  kind: "platform",
  actorId: `process:better-answers-${purpose}`,
});

const nothing = z.object({});

const adminsOnly = declareAct({
  admits: { role: "Admin", purposes: [] },
  input: nothing,
  refuses: ["role-forbids"],
  effect: "write",
});

const everyone = declareAct({
  admits: { role: "Viewer", purposes: EVERY_PURPOSE },
  input: nothing,
  refuses: ["role-forbids"],
  effect: "read",
});

const erasureOnly = declareAct({
  admits: { role: "Admin", purposes: ["erasure"] },
  input: nothing,
  refuses: ["role-forbids"],
  effect: "write",
});

const classOf = (word: string): string | undefined =>
  refusalRegister().find((entry) => entry.word === word)?.class;

describe("what an act admits, from the principal and input alone", () => {
  it("admits only an Admin where the level is Admin", () => {
    const answered = (["Admin", "Editor", "Viewer"] as const).map(
      (role) => admit(adminsOnly, person(role), {}).ok,
    );

    expect(answered).toEqual([true, false, false]);
  });

  it("reads a role as a level admitting every role above", () => {
    const answered = (["Admin", "Editor", "Viewer"] as const).map(
      (role) => admit(everyone, person(role), {}).ok,
    );

    expect(answered).toEqual([true, true, true]);
  });

  it("keys a platform principal off its actor id's purpose", () => {
    expect([
      admit(erasureOnly, processActor("erasure"), {}).ok,
      admit(erasureOnly, processActor("reconciler"), {}).ok,
      admit(everyone, processActor("reconciler"), {}).ok,
    ]).toEqual([true, false, true]);
  });

  it("refuses a platform principal where an act names no purpose", () => {
    expect(admit(adminsOnly, processActor("erasure"), {}).ok).toBe(false);
  });

  it("hands back the principal narrowed to the admitted role", () => {
    const admitted = admit(adminsOnly, person("Admin"), {});

    if (!admitted.ok) throw new Error(`an Admin was refused: ${admitted.error}`);
    expect(admitted.value.role).toBe("Admin");
    expectTypeOf(admitted.value).toExtend<UserPrincipal & { role: "Admin" }>();
  });

  it("refuses in role-forbids, a word of the forbidden class", () => {
    const refused = admit(adminsOnly, person("Viewer"), {});

    expect(refused).toEqual({ ok: false, error: "role-forbids" });
    expect(classOf("role-forbids")).toBe("forbidden");
    expectTypeOf<"role-forbids">().toExtend<AdmissionRefusal>();
  });

  it("holds an admission's word to the forbidden and unauthenticated classes", () => {
    expectTypeOf<"role-forbids">().toExtend<AdmissionRefusal>();
    expectTypeOf<"credentials-revoked">().toExtend<AdmissionRefusal>();
    expectTypeOf<"malformed">().not.toExtend<AdmissionRefusal>();
    expectTypeOf<"not-found">().not.toExtend<AdmissionRefusal>();

    expect(classOf("malformed")).toBe("malformed");
  });
});

describe("what a declaration will not let an act say", () => {
  it("refuses an act declaring one word twice", () => {
    expect(() =>
      declareAct({
        admits: { role: "Admin", purposes: [] },
        input: nothing,
        refuses: ["role-forbids", "role-forbids"],
        effect: "write",
      }),
    ).toThrow("listed twice");
  });
});

describe("the two acts that carry a declaration today", () => {
  it("states what reprocessing a binding admits, takes, answers and does", () => {
    expect({
      admits: reprocessBindingAct.admits,
      refuses: reprocessBindingAct.refuses,
      effect: reprocessBindingAct.effect,
    }).toEqual({
      admits: { role: "Admin", purposes: ["erasure"] },
      refuses: ["role-forbids", "no-such-binding"],
      effect: "write",
    });
  });

  it("admits only an Admin and the erasure process to reprocess", () => {
    const wipe = reprocessBindingInput.parse({
      workspaceId: "01JQ0000000000000000000WSP",
      bindingId: "01J6NNNNNNNNNNNNNNNNNNNNN1",
      reason: "wiped",
    });

    expect({
      admitted: [
        processActor("erasure"),
        processActor("reconciler"),
        processActor("upload-sweep"),
        person("Admin"),
        person("Editor"),
        person("Viewer"),
      ].map((principal) => admit(reprocessBindingAct, principal, wipe).ok),
      refused: admit(reprocessBindingAct, processActor("reconciler"), wipe),
      itsClass: classOf("role-forbids"),
    }).toEqual({
      admitted: [true, false, false, true, false, false],
      refused: { ok: false, error: "role-forbids" },
      itsClass: "forbidden",
    });
  });

  it("derives the act's input and refusal types from its declaration", () => {
    expectTypeOf<InputOf<typeof reprocessBindingAct>>().toEqualTypeOf<ReprocessBindingInput>();
    expectTypeOf<RefusalOf<typeof reprocessBindingAct>>().toEqualTypeOf<
      "role-forbids" | "no-such-binding"
    >();
    expectTypeOf<"no-such-binding">().toExtend<ReprocessBindingRefusal>();
    expectTypeOf<AdmittedOf<typeof reprocessBindingAct>>().toExtend<
      UserPrincipal | PlatformPrincipal
    >();
    expectTypeOf<PlatformPrincipal>().toExtend<AdmittedOf<typeof reprocessBindingAct>>();
  });

  it("lets the platform reprocess but not publish, preview or administer", () => {
    expectTypeOf<PlatformPrincipal>().toExtend<Parameters<typeof reprocessBinding>[0]>();
    expectTypeOf<PlatformPrincipal>().not.toExtend<Parameters<typeof publishBinding>[0]>();
    expectTypeOf<PlatformPrincipal>().not.toExtend<Parameters<typeof dpiaInputFor>[0]>();
    expectTypeOf<PlatformPrincipal>().not.toExtend<Parameters<typeof previewChunks>[0]>();
    expectTypeOf<PlatformPrincipal>().not.toExtend<Parameters<typeof adminOnBinding>[0]>();
  });

  it("reads the enqueue's level off the kind's descriptor", () => {
    const audit = enqueueJobInput.parse({
      workspaceId: "01JQ0000000000000000000WSP",
      kind: "nightly-audit",
    });
    const asked = enqueueJobAct.admits;

    expect(typeof asked === "function" ? asked(audit) : asked).toEqual({
      role: "Admin",
      purposes: EVERY_PURPOSE,
    });
  });

  it("admits the platform to the enqueue for any purpose", () => {
    const audit = enqueueJobInput.parse({
      workspaceId: "01JQ0000000000000000000WSP",
      kind: "nightly-audit",
    });

    expect([
      admit(enqueueJobAct, processActor("reconciler"), audit).ok,
      admit(enqueueJobAct, person("Admin"), audit).ok,
      admit(enqueueJobAct, person("Editor"), audit).ok,
    ]).toEqual([true, true, false]);
  });

  it("declares both the enqueue and reprocessing as writes", () => {
    expect([enqueueJobAct.effect, reprocessBindingAct.effect]).toEqual(["write", "write"]);
  });
});
