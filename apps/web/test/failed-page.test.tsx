import { CatchBoundary, RouterContextProvider, createMemoryHistory } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FailedPage } from "@/app/failed-page.tsx";
import { createAppClients, Providers } from "@/app/providers.tsx";
import { createAppRouter } from "@/app/router.tsx";
import { FAILED_PAGE, goHome, UNKNOWN_PAGE } from "@/app/words.ts";
import { HOMES } from "@/shared/navigation.ts";
import { PRODUCT_NAME } from "@/shared/words.ts";

import { openApp } from "./open-app.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const A_MEMBER = {
  workspace: { id: "w", name: "Northern Tooling" },
  person: { id: "p", name: "Ada", email: "ada@example.test" },
  role: "Admin",
};

const NOT_A_LIST = { why: "the api answered a shape the model choices card cannot render" };

const answerTrpc = (input: string | URL | Request): Promise<Response> => {
  const url = new URL(
    typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    "http://app.test",
  );
  const answers = url.pathname
    .replace("/trpc/", "")
    .split(",")
    .map((procedure) => ({
      result: { data: procedure === "modelChoices.list" ? NOT_A_LIST : A_MEMBER },
    }));
  return Promise.resolve(
    new Response(JSON.stringify(answers), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
};

const MODELS_AND_SPEND = "/models/models-and-spend";

/** jsdom applies no stylesheet, so the band's empty alert counts as an alert here too. */
const saying = () => screen.getAllByRole("alert").filter((alert) => alert.textContent !== "");

const openModelChoicesWithABrokenRead = async () => {
  vi.stubGlobal("fetch", answerTrpc);
  const { rendered } = await openApp(MODELS_AND_SPEND);
  await waitFor(() => {
    expect(saying()).toHaveLength(1);
  });
  return rendered;
};

describe("a page that throws", () => {
  it("leaves the rail, menu, band and content standing", async () => {
    await openModelChoicesWithABrokenRead();

    const band = screen.getByRole("banner");
    expect(within(band).getByRole("link", { name: PRODUCT_NAME })).toBeDefined();
    expect(within(band).getByText(A_MEMBER.workspace.name)).toBeDefined();
    expect(within(band).getByRole("button", { name: "Hide the menu" })).toBeDefined();
    expect(screen.getByRole("main")).toBeDefined();
    const rail = screen.getByRole("navigation", { name: "Areas" });
    expect(within(rail).getByRole("link", { name: "Control Centre" })).toBeDefined();
    const nav = screen.getByRole("navigation", { name: "Control Centre" });
    expect(within(nav).getByRole("link", { name: "Models and spend" })).toBeDefined();

    expect(saying().map((alert) => screen.getByRole("main").contains(alert))).toEqual([true]);
  });

  it("says the page did not load, as an alert", async () => {
    await openModelChoicesWithABrokenRead();

    const [alert = document.body] = saying();
    expect(within(alert).getByRole("heading", { level: 1 }).textContent).toBe(
      "This page didn’t load",
    );
    expect(alert.textContent).toContain(FAILED_PAGE.said);
  });

  it("shows no message, name or stack from what threw", async () => {
    const { container } = await openModelChoicesWithABrokenRead();

    const shown = container.textContent;
    expect(shown).not.toContain("map is not a function");
    expect(shown).not.toContain("TypeError");
    expect(shown).not.toContain("Error");
    expect(container.querySelector("pre")).toBeNull();

    expect(shown).not.toMatch(/report|logged|recorded|notified|team/i);
  });

  it("offers the two ways out as controls a keyboard reaches", async () => {
    await openModelChoicesWithABrokenRead();

    const again = screen.getByRole("button", { name: FAILED_PAGE.retry });

    expect(again.tagName).toBe("BUTTON");
    expect(again.getAttribute("tabindex")).toBeNull();
    expect(again.hasAttribute("disabled")).toBe(false);
    again.focus();
    expect(document.activeElement).toBe(again);

    const away = await screen.findByRole("link", { name: goHome(HOMES.Admin) });
    expect(away.getAttribute("href")).toBe(HOMES.Admin.path);
  });

  it("offers no way home to a reader whose home failed", async () => {
    vi.stubGlobal("fetch", answerTrpc);
    await openApp(HOMES.Admin.path);

    expect(await screen.findByRole("button", { name: FAILED_PAGE.retry })).toBeDefined();
    expect(within(screen.getByRole("main")).queryAllByRole("link")).toEqual([]);
  });

  it("draws the page again when the reader asks for it", () => {
    let broken = true;
    const DrawsWhenItCan = () => {
      if (broken) throw new Error("the page's own bug");
      return <p>The page drew.</p>;
    };

    const clients = createAppClients();
    const router = createAppRouter(
      clients,
      createMemoryHistory({ initialEntries: [MODELS_AND_SPEND] }),
    );
    render(
      <Providers clients={clients}>
        <RouterContextProvider router={router}>
          <CatchBoundary getResetKey={() => "the reader's own retry"} errorComponent={FailedPage}>
            <DrawsWhenItCan />
          </CatchBoundary>
        </RouterContextProvider>
      </Providers>,
    );

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(FAILED_PAGE.heading);

    broken = false;
    expect(screen.queryByText("The page drew.")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: FAILED_PAGE.retry }));

    expect(screen.getByText("The page drew.")).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("leaves an unknown address to the not-found page", async () => {
    vi.stubGlobal("fetch", answerTrpc);

    await openApp("/not-a-page");

    expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe(
      UNKNOWN_PAGE.heading,
    );
  });
});
