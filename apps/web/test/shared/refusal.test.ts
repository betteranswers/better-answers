import { describe, expect, expectTypeOf, it } from "vitest";

import { createQueryClient, type FailedDuring } from "@/shared/api/query-client.ts";
import { refusalOf, type Refusal, type RefusalClass, type RefusalWord } from "@/shared/api/trpc.ts";
import { refusalSentence, STOCK } from "@/shared/refusal-words.ts";
import { carrying } from "@test/stubbed-api.ts";

const retryPolicy = () => {
  const policy = createQueryClient().getDefaultOptions().queries?.retry;
  if (typeof policy !== "function") throw new Error("the query client has no retry function");
  return policy;
};

const ATTEMPTS_ALREADY_MADE = 0;

const NOT_ANSWERED = new Error("the network went away");

const clientRecordingFailures = () => {
  const failures: FailedDuring[] = [];
  const client = createQueryClient((_, during) => {
    failures.push(during);
  });
  return { failures, client };
};

describe("parsing an api refusal", () => {
  it("returns the refusal word and its class", () => {
    const refusal = refusalOf(carrying({ refusal: { word: "no-such-binding", class: "absent" } }));

    expect(refusal).toEqual({ word: "no-such-binding", class: "absent" });
  });

  it("returns the invalid fields of a malformed input", () => {
    const refusal = refusalOf(
      carrying({
        refusal: { word: "malformed", class: "malformed", fields: { sensitivity: "not-a-word" } },
      }),
    );

    expect(refusal?.fields).toEqual({ sensitivity: "not-a-word" });
  });

  it("returns nothing for a failure without a refusal", () => {
    expect(refusalOf(carrying({ code: "INTERNAL_SERVER_ERROR" }))).toBeUndefined();
    expect(refusalOf(new Error("the network went away"))).toBeUndefined();
  });

  it("infers every registered refusal word from the router", () => {
    expectTypeOf<"no-session">().toExtend<RefusalWord>();
    expectTypeOf<"no-active-workspace">().toExtend<RefusalWord>();
    expectTypeOf<"workspace-switched">().toExtend<RefusalWord>();
    expectTypeOf<"workspace-unnamed">().toExtend<RefusalWord>();
    expectTypeOf<"no-such-workspace">().toExtend<RefusalWord>();
    expectTypeOf<"credentials-revoked">().toExtend<RefusalWord>();
    expectTypeOf<"role-forbids">().toExtend<RefusalWord>();
    expectTypeOf<"widening-refused">().toExtend<RefusalWord>();
    expectTypeOf<"no-such-group">().toExtend<RefusalWord>();
    // @ts-expect-error — an undeclared word is not a RefusalWord.
    expectTypeOf<"no-such-thing">().toExtend<RefusalWord>();
  });

  it("has exactly seven refusal classes", () => {
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

describe("a workspace-switched refusal", () => {
  it("has its own message when the feature lists none", () => {
    const sentence = refusalSentence({}, "workspace-switched", "conflict");

    expect(sentence).not.toBe(STOCK.changed);
    expect(sentence).not.toBe(refusalSentence({}, "changed-meanwhile", "conflict"));
  });
});

describe("the retry policy", () => {
  it.each([
    ["unauthenticated", "no-session"],
    ["absent", "no-such-binding"],
    ["precondition", "not-indexed"],
  ])("does not retry a refusal in the %s class", (refusalClass, word) => {
    const retries = retryPolicy()(
      ATTEMPTS_ALREADY_MADE,
      carrying({ refusal: { word, class: refusalClass } }),
    );

    expect(retries).toBe(false);
  });

  it("retries a failure that is not a refusal", () => {
    const retries = retryPolicy()(ATTEMPTS_ALREADY_MADE, new Error("the network went away"));

    expect(retries).toBe(true);
  });
});

describe("the failure callback", () => {
  it("reports a failed query as a read", async () => {
    const { failures, client } = clientRecordingFailures();

    await client
      .query({
        queryKey: ["a-read"],
        queryFn: () => Promise.reject(NOT_ANSWERED),
        retry: false,
      })
      .catch(() => undefined);

    expect(failures).toEqual(["read"]);
  });

  it("reports a failed mutation as an action", async () => {
    const { failures, client } = clientRecordingFailures();

    await client
      .getMutationCache()
      .build(client, { mutationFn: () => Promise.reject(NOT_ANSWERED) })
      .execute(undefined)
      .catch(() => undefined);

    expect(failures).toEqual(["action"]);
  });
});
