import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RAIL } from "@/app/words.ts";
import { NOT_THE_OPERATOR, ONLY_THE_OPERATOR } from "@/features/console/refusal-words.ts";
import { HOMES } from "@/shared/navigation.ts";
import { PRODUCT_NAME } from "@/shared/words.ts";

import { openApp } from "./open-app.tsx";
import { addressOf, answered } from "./stubbed-api.ts";

const REFUSED_CODE = -32_001;

type Answer = { readonly result: { readonly data: unknown } } | { readonly error: unknown };

const NO_SESSION: Answer = {
  error: {
    message: "no-session",
    code: REFUSED_CODE,
    data: {
      code: "UNAUTHORIZED",
      httpStatus: 401,
      refusal: { word: "no-session", class: "unauthenticated" },
    },
  },
};

/** The api answers a batch as one array, one entry per procedure it names. */
const answering = (standing: Answer) => (input: string | URL | Request) => {
  const { pathname } = addressOf(input);
  if (!pathname.startsWith("/trpc/")) return answered(null);

  const names = pathname.replace("/trpc/", "").split(",");
  return answered(
    names.map((name) => (name === "session.operator" ? standing : { result: { data: [] } })),
  );
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the console's shell", () => {
  it("draws the console's area, groups and pages for the operator", async () => {
    vi.stubGlobal("fetch", answering({ result: { data: { operator: true, name: "Ada" } } }));

    const { router } = await openApp("/console");
    const nav = await screen.findByRole("navigation", { name: "Console" });
    const namesIn = (region: HTMLElement, role: "link" | "heading") =>
      within(region)
        .getAllByRole(role, role === "heading" ? { level: 3 } : {})
        .map((each) => each.textContent);

    expect(router.state.location.pathname).toBe("/console/workspaces/every-workspace");
    expect(namesIn(screen.getByRole("navigation", { name: RAIL }), "link")).toEqual(["Console"]);
    expect(namesIn(nav, "heading")).toEqual(["People", "Workspaces"]);
    expect(namesIn(nav, "link")).toEqual(["Everyone", "Names waiting", "Every workspace"]);
    expect(screen.queryByRole("navigation", { name: "Control Centre" })).toBeNull();
  });

  it("reads Console and the person's name, with no role", async () => {
    vi.stubGlobal("fetch", answering({ result: { data: { operator: true, name: "Ada" } } }));

    await openApp("/console/workspaces/every-workspace");
    const bar = await screen.findByRole("banner");

    expect(within(bar).getByRole("button", { name: "Console" })).toBeDefined();
    const you = within(bar).getByRole("button", { name: "Ada" });
    expect(within(you).getByText("A", { exact: true })).toBeDefined();
    expect(you.textContent).not.toMatch(/Admin|Editor|Viewer/);
    const logo = within(bar).getByRole("link", { name: PRODUCT_NAME });
    expect(logo.getAttribute("href")).toBe(HOMES.operator.path);
  });

  it("shows a person without the mark the refused state alone", async () => {
    vi.stubGlobal("fetch", answering({ result: { data: { operator: false } } }));

    await openApp("/console/workspaces/every-workspace");

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "The console is the operator's alone",
    );
    const refused = screen.getByRole("alert").textContent;
    expect(refused).toBe(`${ONLY_THE_OPERATOR.why} ${ONLY_THE_OPERATOR.next}`);
    expect(refused).not.toContain(NOT_THE_OPERATOR);
    expect(screen.queryByRole("navigation", { name: "Console" })).toBeNull();
  });

  it("sends a sessionless person to sign in, then back", async () => {
    vi.stubGlobal("fetch", answering(NO_SESSION));

    const { router } = await openApp("/console/people/everyone");

    expect(router.state.location.href).toBe("/sign-in?redirect=%2Fconsole%2Fpeople%2Feveryone");
  });
});
