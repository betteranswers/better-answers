import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Providers } from "@/app/providers.tsx";
import { createAppRouter } from "@/app/router.tsx";
import { SCREENS } from "@/shared/screens.ts";

afterEach(cleanup);

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

    expect(screen.getByText(/The rest of System/)).toBeDefined();
  });

  it("names nobody until it knows, rather than guessing", async () => {
    const { container } = await openAt("/system");

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
