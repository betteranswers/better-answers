import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UNKNOWN_SCREEN } from "@/app/words.ts";
import { ROLES } from "@/features/people/role-meanings.ts";
import {
  CONTROL_CENTRE,
  HOMES,
  READER_SCREENS,
  READER_SURFACE,
  viewsOf,
  type Role,
} from "@/shared/screens.ts";

import { appAt, openApp } from "./open-app.tsx";
import { addressOf, answered } from "./stubbed-api.ts";

const ASK_MEANWHILE =
  "Ask in Claude for now. Your questions and their answers will be listed here.";

const A_SESSION = { session: { activeOrganizationId: "w" }, user: { id: "p", name: "Ada" } };

/** The api answers a batch as one array, one entry per procedure it names. */
const answering =
  (role: Role, operator = false) =>
  (input: string | URL | Request): Promise<Response> => {
    const { pathname } = addressOf(input);
    if (!pathname.startsWith("/trpc/")) return answered(A_SESSION);

    const data: Readonly<Record<string, unknown>> = {
      "session.membership": {
        workspace: { id: "w", name: "Northern Tooling" },
        person: { id: "p", name: "Ada", email: "ada@example.test" },
        role,
      },
      "session.operator": { operator, name: "Ada" },
    };
    const names = pathname.replace("/trpc/", "").split(",");
    return answered(names.map((name) => ({ result: { data: data[name] ?? null } })));
  };

/** Unbuilt, so Control Centre is drawn with nothing asked of the api but the member. */
const IN_CONTROL_CENTRE = "/knowledge/review-table";

const railOf = (name: string) => screen.getByRole("navigation", { name });

const namesIn = (region: HTMLElement) =>
  within(region)
    .getAllByRole("link")
    .map((link) => link.textContent);

const menuButton = () => screen.getByRole("button", { name: /Ada/ });

/** Opened once every answer is in, so a link the operator's standing adds is there or never. */
const personMenuAt = async (path: string) => {
  const opened = await openApp(path);
  await vi.waitFor(() => expect(opened.clients.queryClient.isFetching()).toBe(0));
  // Radix opens a menu button on Enter, as a keyboard reader would.
  fireEvent.keyDown(menuButton(), { key: "Enter" });
  const items = await screen.findAllByRole("menuitem");
  return {
    items: items.map((item) => [item.textContent, item.getAttribute("href")]),
    router: opened.router,
    unmount: opened.rendered.unmount,
  };
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the reader surface's one list of screens and their views", () => {
  it("declares Ask alone, with New question and Your questions unbuilt", () => {
    expect(
      READER_SCREENS.map((each) => [
        each.name,
        each.path,
        each.defaultView,
        viewsOf(each).map((view) => [view.name, view.path, view.built]),
      ]),
    ).toEqual([
      [
        "Ask",
        "/ask",
        "/ask/new-question",
        [
          ["New question", "/ask/new-question", false],
          ["Your questions", "/ask/your-questions", false],
        ],
      ],
    ]);
  });

  it("homes Admins on People, Editors and Viewers on Ask", () => {
    expect(ROLES.map((role) => [role, HOMES[role].path])).toEqual([
      ["Admin", "/people"],
      ["Editor", "/ask"],
      ["Viewer", "/ask"],
    ]);
    expect(CONTROL_CENTRE.homes).toBe(HOMES);
    expect(READER_SURFACE.homes).toBe(HOMES);
  });

  it("lands Ask's own address on New question", async () => {
    vi.stubGlobal("fetch", answering("Viewer"));

    const { router } = await appAt("/ask");

    expect(router.state.location.pathname).toBe("/ask/new-question");
  });
});

describe("the reader surface's shell", () => {
  it("draws the frame's regions under the product's name", async () => {
    vi.stubGlobal("fetch", answering("Viewer"));

    await openApp("/ask/new-question");

    expect(namesIn(railOf("Better Answers"))).toEqual(["Ask"]);
    expect(namesIn(railOf("Ask"))).toEqual(["New question", "Your questions"]);
    expect(screen.queryByRole("navigation", { name: "Control Centre" })).toBeNull();
    const bar = screen.getByRole("banner");
    expect(await within(bar).findByText("Northern Tooling")).toBeDefined();
    expect(within(bar).getByText("New question", { exact: false })).toBeDefined();
    expect(screen.getByRole("main")).toBeDefined();
  });

  it("tells a reader on either view to ask in Claude", async () => {
    vi.stubGlobal("fetch", answering("Editor"));

    for (const view of viewsOf(READER_SCREENS[0])) {
      const { rendered } = await openApp(view.path);
      const main = screen.getByRole("main");
      expect(within(main).getByRole("heading", { level: 1 }).textContent).toBe("Ask");
      expect(within(main).getByRole("heading", { level: 2 }).textContent).toBe(view.name);
      expect(within(main).getByText(ASK_MEANWHILE)).toBeDefined();
      rendered.unmount();
    }
  });

  it("says an unknown view names no screen, rail kept", async () => {
    vi.stubGlobal("fetch", answering("Viewer"));

    await openApp("/ask/not-a-view");

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(UNKNOWN_SCREEN.heading);
    expect(railOf("Better Answers")).toBeDefined();
  });
});

describe("the person menu on the workspace's two surfaces", () => {
  it("leads from Control Centre to Ask", async () => {
    vi.stubGlobal("fetch", answering("Admin"));

    expect((await personMenuAt(IN_CONTROL_CENTRE)).items).toEqual([
      ["Ask", "/ask"],
      ["Sign out", null],
    ]);
  });

  it("leads an Admin from Ask to Control Centre at People", async () => {
    vi.stubGlobal("fetch", answering("Admin"));

    expect((await personMenuAt("/ask/new-question")).items).toEqual([
      ["Control Centre", "/people"],
      ["Sign out", null],
    ]);
  });

  it("leads a Viewer from Ask to Control Centre's first screen", async () => {
    vi.stubGlobal("fetch", answering("Viewer"));

    expect((await personMenuAt("/ask/your-questions")).items).toEqual([
      ["Control Centre", "/sources"],
      ["Sign out", null],
    ]);
  });

  it("adds the console for the operator on either surface", async () => {
    vi.stubGlobal("fetch", answering("Editor", true));

    const onAsk = await personMenuAt("/ask/new-question");
    expect(onAsk.items).toContainEqual(["Console", "/console"]);
    onAsk.unmount();

    expect((await personMenuAt(IN_CONTROL_CENTRE)).items).toContainEqual(["Console", "/console"]);
  });

  it("crosses to Ask with focus back on the menu button", async () => {
    vi.stubGlobal("fetch", answering("Viewer"));
    const { router } = await personMenuAt(IN_CONTROL_CENTRE);

    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Ask" }), { key: "Enter" });

    await vi.waitFor(() => expect(router.state.location.pathname).toBe("/ask/new-question"));
    expect(railOf("Better Answers")).toBeDefined();
    await vi.waitFor(() => expect(document.activeElement).toBe(menuButton()));
  });
});
