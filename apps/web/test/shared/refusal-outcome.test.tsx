import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, expectTypeOf, it } from "vitest";

import type { Refusal, RefusalClass, RefusalWord } from "@/shared/api/trpc.ts";
import {
  RefusedItemLines,
  refusalsOf,
  saidOfItems,
  setRefusalOutcome,
} from "@/shared/refusal-outcome.tsx";
import { STOCK, stockWait, type OwnSentences } from "@/shared/refusal-words.ts";
import { carrying } from "@test/stubbed-api.ts";

afterEach(cleanup);

const FEATURE_SENTENCES = {
  "last-admin": "Feature-specific sentence for the last Admin.",
} satisfies OwnSentences;

const refusedWith = (word: string, refusalClass: string): Error =>
  carrying({ refusal: { word, class: refusalClass } });

const renderWords = (words: ReactNode): HTMLElement => render(<p>{words}</p>).container;

const NETWORK_FAILURE = new Error("the network went away");

const { outcomeOfFailure, refusedFor } = refusalsOf(FEATURE_SENTENCES);

const STOCK_OF_EACH_CLASS = [
  ["unauthenticated", STOCK.session],
  ["forbidden", STOCK.permission],
  ["absent", STOCK.gone],
  ["malformed", STOCK.invalid],
  ["inapplicable", STOCK.unavailable],
  ["conflict", STOCK.changed],
  ["precondition", STOCK.notYet],
] as const satisfies readonly (readonly [RefusalClass, string])[];

describe("the message shown for a refusal", () => {
  it("uses the feature's sentence for a listed word", () => {
    const outcome = refusedFor("last-admin", "precondition");

    expect(outcome.tone).toBe("refused");
    expect(renderWords(outcome.words).textContent).toBe(FEATURE_SENTENCES["last-admin"]);
    expect(FEATURE_SENTENCES["last-admin"]).not.toBe(STOCK.notYet);
  });

  it("uses the class's stock sentence for an unlisted word", () => {
    const outcome = outcomeOfFailure(refusedWith("role-forbids", "forbidden"), "action");

    expect(outcome.tone).toBe("refused");
    expect(renderWords(outcome.words).textContent).toBe(STOCK.permission);
  });

  it.each(STOCK_OF_EACH_CLASS)(
    "uses the stock sentence for an unknown %s word",
    (refusalClass, stock) => {
      const outcome = outcomeOfFailure(refusedWith("a-new-word", refusalClass), "action");

      expect(renderWords(outcome.words).textContent).toBe(stock);
    },
  );

  it.each(["a-new-class", "toString"])(
    "shows the general sentence for class %s",
    (refusalClass) => {
      const outcome = outcomeOfFailure(refusedWith("a-new-word", refusalClass), "action");

      expect(outcome.tone).toBe("refused");
      expect(renderWords(outcome.words).textContent).toBe(STOCK.general);
    },
  );

  it("gives each class a different stock sentence", () => {
    const sentences = STOCK_OF_EACH_CLASS.map(
      ([refusalClass]) =>
        renderWords(outcomeOfFailure(refusedWith("a-new-word", refusalClass), "action").words)
          .textContent,
    );

    expect(new Set(sentences).size).toBe(STOCK_OF_EACH_CLASS.length);
  });

  it.each([
    ["a known word", "last-admin"],
    ["an unknown word", "a-new-word"],
  ])("hides the api word and <code> for %s", (_, word) => {
    const line = renderWords(outcomeOfFailure(refusedWith(word, "precondition"), "action").words);

    expect(line.textContent).not.toContain(word);
    expect(line.querySelector("code")).toBeNull();
  });

  it("asks to retry an action that got no response", () => {
    const outcome = outcomeOfFailure(NETWORK_FAILURE, "action");

    expect(outcome.tone).toBe("refused");
    expect(renderWords(outcome.words).textContent).toBe(STOCK.tryAgain);
  });

  it("reports a read with no response as not loaded", () => {
    const outcome = outcomeOfFailure(NETWORK_FAILURE, "read");

    expect(renderWords(outcome.words).textContent).toBe(STOCK.notLoaded);
    expect(STOCK.notLoaded).not.toBe(STOCK.tryAgain);
  });
});

describe("the wait in a rate-limit message", () => {
  it.each([
    [1, 1],
    [60, 1],
    [61, 2],
    [600, 10],
  ])("shows %i seconds as %i minutes, rounded up", (waitSeconds, minutes) => {
    const numbers = stockWait(waitSeconds).match(/\d+/g);

    expect(numbers).toEqual([String(minutes)]);
  });

  it("shows no number when the response has no wait", () => {
    expect(stockWait(undefined)).not.toMatch(/\d/);
    expect(stockWait(undefined)).not.toBe(stockWait(61));
  });
});

const PEOPLE_SENTENCES = {
  ...FEATURE_SENTENCES,
  "no-such-member": "Feature-specific sentence for a removed member.",
} satisfies OwnSentences;

const nameOf = (id: string): string => (id === "p1" ? "Ada Lovelace" : "Grace Hopper");

const refusedForItems = (items: Readonly<Record<string, string>>): Error =>
  carrying({ refusal: { word: "last-admin", class: "precondition", items } });

describe("per-item reasons in a refusal", () => {
  it("types each item's word as a refusal word", () => {
    expectTypeOf<NonNullable<Refusal["items"]>>().toEqualTypeOf<
      Readonly<Record<string, RefusalWord>>
    >();
  });

  it("gives one reason per item", () => {
    const failure = refusedForItems({ p1: "last-admin", p2: "no-such-member" });

    expect(saidOfItems(PEOPLE_SENTENCES, failure)).toEqual([
      { id: "p1", said: PEOPLE_SENTENCES["last-admin"] },
      { id: "p2", said: PEOPLE_SENTENCES["no-such-member"] },
    ]);
    expect(PEOPLE_SENTENCES["last-admin"]).not.toBe(PEOPLE_SENTENCES["no-such-member"]);
  });

  it("uses the set's sentence for an unlisted item word", () => {
    const failure = refusedForItems({ p1: "last-admin", p2: "a-new-word" });

    expect(saidOfItems(FEATURE_SENTENCES, failure)).toEqual([
      { id: "p1", said: FEATURE_SENTENCES["last-admin"] },
      { id: "p2", said: FEATURE_SENTENCES["last-admin"] },
    ]);
  });

  it("renders one line per item with the person's name", () => {
    const failure = refusedForItems({ p1: "last-admin", p2: "no-such-member" });
    render(<RefusedItemLines featureWords={PEOPLE_SENTENCES} failure={failure} nameOf={nameOf} />);

    expect(screen.getAllByRole("listitem").map((line) => line.textContent)).toEqual([
      `Ada Lovelace: ${PEOPLE_SENTENCES["last-admin"]}`,
      `Grace Hopper: ${PEOPLE_SENTENCES["no-such-member"]}`,
    ]);
  });

  it.each([
    ["a refusal naming no items", refusedWith("last-admin", "precondition")],
    ["a network failure", NETWORK_FAILURE],
  ])("gives no reason for %s", (_, failure) => {
    expect(saidOfItems(PEOPLE_SENTENCES, failure)).toEqual([]);
  });
});

const refusedCountLead = (count: number): string => `${String(count)} refused:`;

describe("a refusal of a whole set", () => {
  it("uses the refusal's sentence when no item is named", () => {
    const outcome = setRefusalOutcome({
      featureWords: FEATURE_SENTENCES,
      failure: refusedWith("last-admin", "precondition"),
      nameOf,
      lead: refusedCountLead,
    });

    expect(outcome.tone).toBe("refused");
    expect(renderWords(outcome.words).textContent).toBe(FEATURE_SENTENCES["last-admin"]);
  });
});
