import { describe, expect, expectTypeOf, it } from "vitest";

import { createQueryClient } from "@/shared/api/query-client.ts";
import { refusalOf, type Refusal, type RefusalClass, type RefusalWord } from "@/shared/api/trpc.ts";

import { carrying } from "./stubbed-api.ts";

const retryPolicy = () => {
  const policy = createQueryClient().getDefaultOptions().queries?.retry;
  if (typeof policy !== "function") throw new Error("the query client carries no retry policy");
  return policy;
};

const ATTEMPTS_ALREADY_MADE = 0;

describe("the refusal the api sends the web", () => {
  it("reads the word and its class off a refused read", () => {
    const read = refusalOf(carrying({ refusal: { word: "no-such-binding", class: "absent" } }));

    expect(read).toEqual({ word: "no-such-binding", class: "absent" });
  });

  it("reads which fields a malformed input names", () => {
    const read = refusalOf(
      carrying({
        refusal: { word: "malformed", class: "malformed", fields: { sensitivity: "not-a-word" } },
      }),
    );

    expect(read?.fields).toEqual({ sensitivity: "not-a-word" });
  });

  it("reads nothing off a failure carrying no refusal", () => {
    expect(refusalOf(carrying({ code: "INTERNAL_SERVER_ERROR" }))).toBeUndefined();
    expect(refusalOf(new Error("the network went away"))).toBeUndefined();
  });

  it("infers every word the api registered from the router", () => {
    expectTypeOf<"no-session">().toExtend<RefusalWord>();
    expectTypeOf<"no-active-workspace">().toExtend<RefusalWord>();
    expectTypeOf<"no-such-workspace">().toExtend<RefusalWord>();
    expectTypeOf<"credentials-revoked">().toExtend<RefusalWord>();
    expectTypeOf<"role-forbids">().toExtend<RefusalWord>();
    expectTypeOf<"widening-refused">().toExtend<RefusalWord>();
    expectTypeOf<"no-such-group">().toExtend<RefusalWord>();
    // @ts-expect-error — a word no slice declared never crosses to the web.
    expectTypeOf<"no-such-thing">().toExtend<RefusalWord>();
  });

  it("knows the seven classes a word is sorted into", () => {
    expectTypeOf<RefusalClass>().toEqualTypeOf<
      | "unauthenticated"
      | "forbidden"
      | "absent"
      | "malformed"
      | "inapplicable"
      | "conflict"
      | "precondition"
    >();
    expectTypeOf<Refusal["word"]>().toEqualTypeOf<RefusalWord>();
  });
});

describe("what the web asks again", () => {
  it.each([
    ["unauthenticated", "no-session"],
    ["absent", "no-such-binding"],
    ["precondition", "not-indexed"],
  ])("never asks again after a refusal in the %s class", (refusalClass, word) => {
    const asked = retryPolicy()(
      ATTEMPTS_ALREADY_MADE,
      carrying({ refusal: { word, class: refusalClass } }),
    );

    expect(asked).toBe(false);
  });

  it("asks again after a failure that is nobody's to fix", () => {
    const asked = retryPolicy()(ATTEMPTS_ALREADY_MADE, new Error("the network went away"));

    expect(asked).toBe(true);
  });
});
