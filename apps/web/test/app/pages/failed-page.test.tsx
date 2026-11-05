import { CatchBoundary, RouterContextProvider, createMemoryHistory } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FailedPage } from "@/app/pages/failed-page.tsx";
import { createAppClients, Providers } from "@/app/providers.tsx";
import { createAppRouter } from "@/app/router.tsx";
import { FAILED_PAGE } from "@/app/words.ts";
import { HOMES } from "@/shared/navigation.ts";
import { openApp } from "@test/open-app.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const A_MEMBER = {
  workspace: { id: "w", name: "Northern Tooling" },
  person: { id: "p", name: "Ada", email: "ada@example.test" },
  role: "Admin",
};

const NOT_A_LIST = { why: "not a list of model choices" };

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

/** jsdom applies no styles, so the band's empty alert is also found and must be skipped. */
const nonEmptyAlerts = () =>
  screen.getAllByRole("alert").filter((alert) => alert.textContent !== "");

const openModelChoicesWithABrokenRead = async () => {
  vi.stubGlobal("fetch", answerTrpc);
  const { rendered } = await openApp(MODELS_AND_SPEND);
  await waitFor(() => {
    expect(nonEmptyAlerts()).toHaveLength(1);
  });
  return rendered;
};

const pageThatThrowsUntilFixed = () => {
  let broken = true;
  return {
    Content: () => {
      if (broken) throw new Error("page render failed");
      return <p>Page content</p>;
    },
    fix: () => {
      broken = false;
    },
  };
};

describe("a page that throws", () => {
  it("keeps the rail, menu, band and main region rendered", async () => {
    await openModelChoicesWithABrokenRead();

    const band = screen.getByRole("banner");
    expect(within(band).getByRole("link", { name: "better-answers" })).toBeDefined();
    expect(within(band).getByText(A_MEMBER.workspace.name)).toBeDefined();
    expect(within(band).getByRole("button", { name: "Hide Menu" })).toBeDefined();
    expect(screen.getByRole("main")).toBeDefined();
    const rail = screen.getByRole("navigation", { name: "Areas" });
    expect(within(rail).getByRole("link", { name: "Control Centre" })).toBeDefined();
    const nav = screen.getByRole("navigation", { name: "Control Centre" });
    expect(within(nav).getByRole("link", { name: "Models and Spend" })).toBeDefined();

    expect(nonEmptyAlerts().map((alert) => screen.getByRole("main").contains(alert))).toEqual([
      true,
    ]);
  });

  it("shows a load-failure alert with a heading", async () => {
    await openModelChoicesWithABrokenRead();

    const [alert = document.body] = nonEmptyAlerts();
    expect(
      within(alert).getByRole("heading", { level: 1, name: "This Page Didn’t Load" }),
    ).toBeDefined();
    expect(alert.textContent).toContain(FAILED_PAGE.said);
  });

  it("hides the error's message, name and stack", async () => {
    const { container } = await openModelChoicesWithABrokenRead();

    const shown = container.textContent;
    expect(shown).not.toContain("map is not a function");
    expect(shown).not.toContain("TypeError");
    expect(shown).not.toContain("Error");
    expect(container.querySelector("pre")).toBeNull();

    expect(screen.getByRole("main").textContent).not.toMatch(
      /report|logged|recorded|notified|team/i,
    );
  });

  it("offers Try Again and a home link, both keyboard-reachable", async () => {
    await openModelChoicesWithABrokenRead();

    const tryAgain = screen.getByRole("button", { name: "Try Again" });

    expect(tryAgain.tagName).toBe("BUTTON");
    expect(tryAgain.getAttribute("tabindex")).toBeNull();
    expect(tryAgain.hasAttribute("disabled")).toBe(false);
    tryAgain.focus();
    expect(document.activeElement).toBe(tryAgain);

    const homeLink = await screen.findByRole("link", { name: "Go to Members" });
    expect(homeLink.getAttribute("href")).toBe(HOMES.Admin.path);
  });

  it("offers no home link when the home page itself failed", async () => {
    vi.stubGlobal("fetch", answerTrpc);
    await openApp(HOMES.Admin.path);

    expect(await screen.findByRole("button", { name: "Try Again" })).toBeDefined();
    expect(within(screen.getByRole("main")).queryAllByRole("link")).toEqual([]);
  });

  it("renders the page again after Try Again", () => {
    const page = pageThatThrowsUntilFixed();

    const clients = createAppClients();
    const router = createAppRouter(
      clients,
      createMemoryHistory({ initialEntries: [MODELS_AND_SPEND] }),
    );
    render(
      <Providers clients={clients}>
        <RouterContextProvider router={router}>
          <CatchBoundary getResetKey={() => "retry"} errorComponent={FailedPage}>
            <page.Content />
          </CatchBoundary>
        </RouterContextProvider>
      </Providers>,
    );

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("This Page Didn’t Load");

    page.fix();
    expect(screen.queryByText("Page content")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Try Again" }));

    expect(screen.getByText("Page content")).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows Page Not Found for an unknown address", async () => {
    vi.stubGlobal("fetch", answerTrpc);

    await openApp("/not-a-page");

    expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe("Page Not Found");
  });
});
