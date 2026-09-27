import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Refused } from "@/features/auth/auth-screen.tsx";
import { SAID_OF_A_REVOCATION, SAID_OF_CORRECTING } from "@/features/console/refusal-words.ts";
import type { Refusal } from "@/shared/api/trpc.ts";
import {
  SAID_OF_CLASS,
  saidOfRefusal,
  sentenceOf,
  SIGN_IN_AGAIN,
  type Said,
} from "@/shared/refusal-words.ts";

import { carrying } from "./stubbed-api.ts";

afterEach(cleanup);

const saidOf = (refusal: Refusal): Said => saidOfRefusal({}, refusal.word, refusal.class);

/** The auth screens' refusal alone on a page, as a screen renders it under its form. */
const refusedOn = async (failure: Error) => {
  const rootRoute = createRootRoute({
    component: () => <Refused id="refused" failure={failure} saidOf={saidOf} />,
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  return screen.getByRole("alert");
};

describe("a refusal beside a way to sign in again", () => {
  it("says the session ended, leaving sign-in to the button", async () => {
    const alert = await refusedOn(
      carrying({ refusal: { word: "no-session", class: "unauthenticated" } }),
    );

    expect(alert.textContent).toBe(SAID_OF_CLASS.unauthenticated.why);
    expect(alert.textContent).not.toContain(SIGN_IN_AGAIN);
    expect(screen.getByRole("button", { name: SIGN_IN_AGAIN })).toBeDefined();
  });

  it("still says what to do where no button follows", async () => {
    const alert = await refusedOn(carrying({ refusal: { word: "a-new-word", class: "conflict" } }));

    expect(alert.textContent).toBe(sentenceOf(SAID_OF_CLASS.conflict));
    expect(screen.queryByRole("button", { name: SIGN_IN_AGAIN })).toBeNull();
  });

  it.each([
    ["revoking", SAID_OF_A_REVOCATION["sign-in-too-old"]],
    ["correcting", SAID_OF_CORRECTING["sign-in-too-old"]],
  ])("leaves the link's label out of stale words: %s", (_, said) => {
    expect(sentenceOf(said).toLowerCase()).not.toContain(SIGN_IN_AGAIN.toLowerCase());
  });
});

describe("the ended session with nothing after it", () => {
  it("still ends with the instruction to sign in again", () => {
    expect(sentenceOf(SAID_OF_CLASS.unauthenticated).endsWith(`${SIGN_IN_AGAIN}.`)).toBe(true);
  });
});
