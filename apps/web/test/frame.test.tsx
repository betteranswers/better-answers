import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Providers } from "@/app/providers.tsx";
import { createAppRouter } from "@/app/router.tsx";
import { SCREENS } from "@/shared/screens.ts";

/**
 * The frame's own behaviour, through the router a browser drives (`[TEST1]`: a rendered
 * component through Testing Library where a component's behaviour is the thing under test).
 * What the api does with the built shell is the browser suite's, in `e2e/`.
 */

// Vitest runs without globals here, so Testing Library's automatic cleanup never
// registers itself and a second render would find the first one still in the document.
afterEach(cleanup);

/**
 * The tree `main.tsx` mounts, minus the browser: the providers outside, the router inside.
 * The frame reads who is signed in through them (T-037), and System's routes card reads the
 * tRPC client out of the same context (T-038); a render without them would be testing a
 * composition the app never mounts.
 *
 * Nothing answers here — there is no server behind a jsdom render — so the shell renders
 * without an identity and the card without routes, which is the state a real browser is in
 * for the first paint and the one this suite is about. What either says once it knows is the
 * browser suite's, where a real session exists.
 */
const openAt = async (path: string) => {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
  await router.load();
  return render(
    <Providers>
      <RouterProvider router={router} />
    </Providers>,
  );
};

describe("Control Centre's frame", () => {
  it("names all six screens in the navigation, in the glossary's order", async () => {
    await openAt("/system");

    const navigation = screen.getByRole("navigation", { name: "Control Centre" });
    const named = within(navigation)
      .getAllByRole("link")
      .map((link) => link.textContent);

    expect(named).toEqual(SCREENS.map((each) => each.name));
  });

  it("carries the three landmarks and a skip link as the first thing in the order", async () => {
    const { container } = await openAt("/system");

    expect(screen.getByRole("banner")).toBeDefined();
    expect(screen.getByRole("navigation", { name: "Control Centre" })).toBeDefined();
    expect(screen.getByRole("main")).toBeDefined();

    const first = container.querySelector("a");
    expect(first?.textContent).toBe("Skip to the screen");
    expect(first?.getAttribute("href")).toBe(`#${screen.getByRole("main").id}`);
  });

  it("says the five unbuilt screens are unbuilt, and does not say it of System", async () => {
    const unbuilt: string[] = [];
    for (const each of SCREENS) {
      const { unmount } = await openAt(each.path);
      if (screen.queryByText("This screen is not built yet.") !== null) unbuilt.push(each.name);
      unmount();
    }

    expect(unbuilt).toEqual(["Sources", "Suggestions", "Knowledge", "Questions", "People"]);
  });

  it("gives System the routes card, and says the rest of the screen is unbuilt", async () => {
    await openAt("/system");

    expect(screen.getByRole("heading", { level: 2, name: "Routes" })).toBeDefined();
    // The card's own behaviour — what it lists, and for whom — is the browser suite's
    // (`e2e/routes.spec.ts`), because it needs a session and a workspace to be about.
    // ADR 0025 gives System eight cards; routes is the only one built, and the screen says so.
    expect(screen.getByText(/The rest of System/)).toBeDefined();
  });

  it("names nobody until it knows, rather than guessing", async () => {
    const { container } = await openAt("/system");

    // Nothing has answered, so the shell says nothing about who is reading — no name, no
    // workspace, and not the sign-out that belongs beside them (T-037). A shell that
    // guessed would be saying something it cannot know.
    expect(screen.queryByRole("region", { name: "You" })).toBeNull();
    expect(container.textContent).not.toMatch(/sign out/i);
  });

  it("marks the screen being read, so it is announced and not only shaded", async () => {
    await openAt("/people");

    const current = screen.getByRole("link", { current: "page" });
    expect(current.textContent).toBe("People");
  });

  it("carries an address that is not a screen to a screen that says so", async () => {
    await openAt("/not-a-screen");

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("No such screen");
  });
});
