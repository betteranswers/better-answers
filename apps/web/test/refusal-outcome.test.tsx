import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { failureOutcome, refusalOutcome } from "@/shared/refusal-outcome.tsx";
import { SAID_OF_CLASS, type SaidOfWord } from "@/shared/refusal-words.ts";

import { carrying } from "./stubbed-api.ts";

afterEach(cleanup);

const A_FEATURES_WORDS = {
  "last-admin": {
    why: "Nobody else here is an Admin.",
    next: "Make someone else an Admin first.",
  },
} satisfies SaidOfWord;

/** Any word and class, as the api would send them: a word the web has never met is still said. */
const refusedWith = (word: string, refusalClass: string): Error =>
  carrying({ refusal: { word, class: refusalClass } });

const shown = (words: ReactNode): HTMLElement => render(<p>{words}</p>).container;

const NETWORK_FAILURE = new Error("the network went away");

describe("the shared refusal template", () => {
  it("says what went wrong, then what to do", () => {
    const outcome = refusalOutcome(A_FEATURES_WORDS, "last-admin", "precondition");

    expect(outcome.tone).toBe("refused");
    expect(shown(outcome.words).textContent).toBe(
      "Nobody else here is an Admin. Make someone else an Admin first.",
    );
  });

  it.each(Object.entries(SAID_OF_CLASS))(
    "says an unknown word by its class: %s",
    (refusalClass, said) => {
      const outcome = failureOutcome(A_FEATURES_WORDS, refusedWith("a-new-word", refusalClass));

      expect(shown(outcome.words).textContent).toBe(`${said.why} ${said.next}`);
    },
  );

  it.each([
    ["a known word", "last-admin"],
    ["an unknown word", "a-new-word"],
  ])("shows neither word nor code element for %s", (_, word) => {
    const line = shown(failureOutcome(A_FEATURES_WORDS, refusedWith(word, "precondition")).words);

    expect(line.textContent).not.toContain(word);
    expect(line.querySelector("code")).toBeNull();
  });

  it("says a wordless failure got no response, and nothing saved", () => {
    const outcome = failureOutcome(A_FEATURES_WORDS, NETWORK_FAILURE);

    expect(outcome.tone).toBe("refused");
    expect(shown(outcome.words).textContent).toBe(
      "No response, so nothing was saved. Try again in a moment.",
    );
  });

  it("says a read's wordless failure without claiming a save", () => {
    const outcome = failureOutcome(A_FEATURES_WORDS, NETWORK_FAILURE, "read");

    expect(shown(outcome.words).textContent).toBe(
      "No response, so nothing is shown. Try again in a moment.",
    );
  });
});
