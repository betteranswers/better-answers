import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Refused } from "@/features/auth/auth-page.tsx";
import { STOCK } from "@/shared/refusal-words.ts";

import { carrying } from "./stubbed-api.ts";

afterEach(cleanup);

const THE_PAGES_OWN = "What this page alone says of a refusal.";

const saidOf = (): string => THE_PAGES_OWN;

/** The auth pages' refusal alone on a page, as a page renders it under its form. */
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

const signInAgain = () => screen.queryByRole("button", { name: "Sign In Again" });

describe("a refusal beside a way to sign in again", () => {
  it("shows the session sentence above the sign-in button", async () => {
    const alert = await refusedOn(
      carrying({ refusal: { word: "no-session", class: "unauthenticated" } }),
    );

    expect(alert.textContent).toBe(STOCK.session);
    expect(signInAgain()).not.toBeNull();
  });

  it("shows the page's sentence, and no button, for another refusal", async () => {
    const alert = await refusedOn(carrying({ refusal: { word: "a-new-word", class: "conflict" } }));

    expect(alert.textContent).toBe(THE_PAGES_OWN);
    expect(signInAgain()).toBeNull();
  });

  it("tells an action with no response to try again", async () => {
    const alert = await refusedOn(new Error("the network went away"));

    expect(alert.textContent).toBe(STOCK.tryAgain);
    expect(signInAgain()).toBeNull();
  });
});
