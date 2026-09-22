import { CatchBoundary, RouterContextProvider, createMemoryHistory } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FailedScreen } from "@/app/failed-screen.tsx";
import { createAppClients } from "@/app/providers.tsx";
import { createAppRouter } from "@/app/router.tsx";

import { openApp } from "./open-app.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const A_MEMBERSHIP = {
  workspace: { id: "w", name: "Northern Tooling" },
  person: { id: "p", name: "Ada", email: "ada@example.test" },
  role: "Admin",
};

const NOT_A_LIST = { why: "the api answered a shape the routes card cannot render" };

const answerTrpc = (input: string | URL | Request): Promise<Response> => {
  const url = new URL(
    typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    "http://app.test",
  );
  const answers = url.pathname
    .replace("/trpc/", "")
    .split(",")
    .map((procedure) => ({
      result: { data: procedure === "routes.list" ? NOT_A_LIST : A_MEMBERSHIP },
    }));
  return Promise.resolve(
    new Response(JSON.stringify(answers), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
};

const openSystemWithABrokenRead = async () => {
  vi.stubGlobal("fetch", answerTrpc);
  const { rendered } = await openApp("/system");
  await screen.findByRole("alert");
  return rendered;
};

describe("a screen that throws", () => {
  it("leaves the rail, the secondary nav, the top bar and the content standing", async () => {
    await openSystemWithABrokenRead();

    expect(screen.getByRole("banner")).toBeDefined();
    expect(screen.getByRole("main")).toBeDefined();
    const rail = screen.getByRole("navigation", { name: "Control Centre" });
    expect(within(rail).getByRole("link", { name: "Knowledge" })).toBeDefined();
    const views = screen.getByRole("navigation", { name: "System" });
    expect(within(views).getByRole("link", { name: "Routes and spend" })).toBeDefined();

    expect(screen.getByRole("main").contains(screen.getByRole("alert"))).toBe(true);
  });

  it("says the screen could not be shown, and announces it to assistive technology", async () => {
    await openSystemWithABrokenRead();

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "This screen could not be shown",
    );

    expect(screen.getByRole("alert").textContent).toContain("failed while it was being drawn");
  });

  it("shows a reader nothing of what threw — no message, no name, no stack", async () => {
    const { container } = await openSystemWithABrokenRead();

    const shown = container.textContent;
    expect(shown).not.toContain("map is not a function");
    expect(shown).not.toContain("TypeError");
    expect(shown).not.toContain("Error");
    expect(container.querySelector("pre")).toBeNull();

    expect(shown).not.toMatch(/report|logged|recorded|notified|team/i);
  });

  it("offers the two ways out as controls a keyboard reaches", async () => {
    await openSystemWithABrokenRead();

    const again = screen.getByRole("button", { name: "Try this screen again" });

    expect(again.tagName).toBe("BUTTON");
    expect(again.getAttribute("tabindex")).toBeNull();
    expect(again.hasAttribute("disabled")).toBe(false);
    again.focus();
    expect(document.activeElement).toBe(again);

    const away = screen.getByRole("link", { name: "Go to System" });
    expect(away.getAttribute("href")).toBe("/system");
  });

  it("draws the screen again when the reader asks for it", () => {
    let broken = true;
    const DrawsWhenItCan = () => {
      if (broken) throw new Error("the screen's own bug");
      return <p>The screen drew.</p>;
    };

    const router = createAppRouter(
      createAppClients(),
      createMemoryHistory({ initialEntries: ["/system"] }),
    );
    render(
      <RouterContextProvider router={router}>
        <CatchBoundary getResetKey={() => "the reader's own retry"} errorComponent={FailedScreen}>
          <DrawsWhenItCan />
        </CatchBoundary>
      </RouterContextProvider>,
    );

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "This screen could not be shown",
    );

    broken = false;
    expect(screen.queryByText("The screen drew.")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Try this screen again" }));

    expect(screen.getByText("The screen drew.")).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("leaves an address that is no screen to the screen that already says so", async () => {
    vi.stubGlobal("fetch", answerTrpc);

    await openApp("/not-a-screen");

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("No such screen");
  });
});
