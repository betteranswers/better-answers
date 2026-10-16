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

import { carrying } from "./stubbed-api.ts";

afterEach(cleanup);

const A_FEATURES_OWN = {
  "last-admin": "What this feature alone says of the last Admin.",
} satisfies OwnSentences;

/** Any word and class, as the api would send them: a word the web has never met still shows. */
const refusedWith = (word: string, refusalClass: string): Error =>
  carrying({ refusal: { word, class: refusalClass } });

const shown = (words: ReactNode): HTMLElement => render(<p>{words}</p>).container;

const NETWORK_FAILURE = new Error("the network went away");

const { outcomeOfFailure, refusedFor } = refusalsOf(A_FEATURES_OWN);

const STOCK_OF_EACH_CLASS = [
  ["unauthenticated", STOCK.session],
  ["forbidden", STOCK.permission],
  ["absent", STOCK.gone],
  ["malformed", STOCK.invalid],
  ["inapplicable", STOCK.unavailable],
  ["conflict", STOCK.changed],
  ["precondition", STOCK.notYet],
] as const satisfies readonly (readonly [RefusalClass, string])[];

describe("the sentence a refusal shows", () => {
  it("shows a listed word's own sentence, never its class's", () => {
    const outcome = refusedFor("last-admin", "precondition");

    expect(outcome.tone).toBe("refused");
    expect(shown(outcome.words).textContent).toBe(A_FEATURES_OWN["last-admin"]);
    expect(A_FEATURES_OWN["last-admin"]).not.toBe(STOCK.notYet);
  });

  it("shows an unlisted word its class's stock sentence", () => {
    const outcome = outcomeOfFailure(refusedWith("role-forbids", "forbidden"), "action");

    expect(outcome.tone).toBe("refused");
    expect(shown(outcome.words).textContent).toBe(STOCK.permission);
  });

  it.each(STOCK_OF_EACH_CLASS)("shows a word never met by its class: %s", (refusalClass, stock) => {
    const outcome = outcomeOfFailure(refusedWith("a-new-word", refusalClass), "action");

    expect(shown(outcome.words).textContent).toBe(stock);
  });

  it.each(["a-new-class", "toString"])(
    "shows the general sentence for class %s",
    (refusalClass) => {
      const outcome = outcomeOfFailure(refusedWith("a-new-word", refusalClass), "action");

      expect(outcome.tone).toBe("refused");
      expect(shown(outcome.words).textContent).toBe(STOCK.general);
    },
  );

  it("gives each class a stock sentence of its own", () => {
    const sentences = STOCK_OF_EACH_CLASS.map(
      ([refusalClass]) =>
        shown(outcomeOfFailure(refusedWith("a-new-word", refusalClass), "action").words)
          .textContent,
    );

    expect(new Set(sentences).size).toBe(STOCK_OF_EACH_CLASS.length);
  });

  it.each([
    ["a known word", "last-admin"],
    ["an unknown word", "a-new-word"],
  ])("shows neither word nor code element for %s", (_, word) => {
    const line = shown(outcomeOfFailure(refusedWith(word, "precondition"), "action").words);

    expect(line.textContent).not.toContain(word);
    expect(line.querySelector("code")).toBeNull();
  });

  it("tells an action with no response to try again", () => {
    const outcome = outcomeOfFailure(NETWORK_FAILURE, "action");

    expect(outcome.tone).toBe("refused");
    expect(shown(outcome.words).textContent).toBe(STOCK.tryAgain);
  });

  it("says a read with no response did not load", () => {
    const outcome = outcomeOfFailure(NETWORK_FAILURE, "read");

    expect(shown(outcome.words).textContent).toBe(STOCK.notLoaded);
    expect(STOCK.notLoaded).not.toBe(STOCK.tryAgain);
  });
});

describe("the wait a ceiling's sentence names", () => {
  it.each([
    [1, 1],
    [60, 1],
    [61, 2],
    [600, 10],
  ])("names %i seconds as %i whole minutes, rounded up", (liftsInSeconds, minutes) => {
    const numbers = stockWait(liftsInSeconds).match(/\d+/g);

    expect(numbers).toEqual([String(minutes)]);
  });

  it("names no number where the answer carried no wait", () => {
    expect(stockWait(undefined)).not.toMatch(/\d/);
    expect(stockWait(undefined)).not.toBe(stockWait(61));
  });
});

const THE_PEOPLES_OWN = {
  ...A_FEATURES_OWN,
  "no-such-member": "What this feature alone says of a member since gone.",
} satisfies OwnSentences;

const nameOf = (id: string): string => (id === "p1" ? "Ada Lovelace" : "Grace Hopper");

const refusedForItems = (items: Readonly<Record<string, string>>): Error =>
  carrying({ refusal: { word: "last-admin", class: "precondition", items } });

describe("the reasons a refusal naming items gives", () => {
  it("reads each item's word as a plain api word", () => {
    expectTypeOf<NonNullable<Refusal["items"]>>().toEqualTypeOf<
      Readonly<Record<string, RefusalWord>>
    >();
  });

  it("gives two item words two reasons, one per item", () => {
    const failure = refusedForItems({ p1: "last-admin", p2: "no-such-member" });

    expect(saidOfItems(THE_PEOPLES_OWN, failure)).toEqual([
      { id: "p1", said: THE_PEOPLES_OWN["last-admin"] },
      { id: "p2", said: THE_PEOPLES_OWN["no-such-member"] },
    ]);
    expect(THE_PEOPLES_OWN["last-admin"]).not.toBe(THE_PEOPLES_OWN["no-such-member"]);
  });

  it("gives an unlisted item word the whole set's sentence", () => {
    const failure = refusedForItems({ p1: "last-admin", p2: "a-new-word" });

    expect(saidOfItems(A_FEATURES_OWN, failure)).toEqual([
      { id: "p1", said: A_FEATURES_OWN["last-admin"] },
      { id: "p2", said: A_FEATURES_OWN["last-admin"] },
    ]);
  });

  it("draws one line per item, naming the person", () => {
    const failure = refusedForItems({ p1: "last-admin", p2: "no-such-member" });
    render(<RefusedItemLines featureWords={THE_PEOPLES_OWN} failure={failure} nameOf={nameOf} />);

    expect(screen.getAllByRole("listitem").map((line) => line.textContent)).toEqual([
      `Ada Lovelace: ${THE_PEOPLES_OWN["last-admin"]}`,
      `Grace Hopper: ${THE_PEOPLES_OWN["no-such-member"]}`,
    ]);
  });

  it.each([
    ["a refusal naming no items", refusedWith("last-admin", "precondition")],
    ["a wordless failure", NETWORK_FAILURE],
  ])("gives no reason for %s", (_, failure) => {
    expect(saidOfItems(THE_PEOPLES_OWN, failure)).toEqual([]);
  });
});

const lead = (count: number): string => `${String(count)} refused:`;

describe("a set refused whole", () => {
  it("shows the refusal's own sentence when it names no item", () => {
    const outcome = setRefusalOutcome({
      featureWords: A_FEATURES_OWN,
      failure: refusedWith("last-admin", "precondition"),
      nameOf,
      lead,
    });

    expect(outcome.tone).toBe("refused");
    expect(shown(outcome.words).textContent).toBe(A_FEATURES_OWN["last-admin"]);
  });
});
