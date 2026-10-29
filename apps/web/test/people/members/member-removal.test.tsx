import {
  act,
  cleanup,
  fireEvent,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppClients, Providers } from "@/app/providers.tsx";
import { JUMP_TO } from "@/app/words.ts";
import { useRemovalOf, useRemoveMember } from "@/features/people/people-api.ts";
import { placedWithoutMeasuring } from "@test/measuring.ts";
import { anAdminOver } from "@test/people/member-pages.ts";
import { joined, listed, MEMBERS, PRIYA } from "@test/people/members-roster.ts";
import { answeringAs } from "@test/stubbed-api.ts";
import { ADA, openAt, read as readAnswer } from "@test/two-workspaces.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("removing a member from their page", () => {
  it("waits on the reader's member read, then finds its outcome", async () => {
    const clients = createAppClients();
    clients.queryClient.setDefaultOptions({ queries: { retry: false } });
    const read = Promise.withResolvers<void>();
    const answering = answeringAs("Admin");
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      await read.promise;
      return answering(input);
    });
    const { result } = renderHook(
      () => ({ removal: useRemoveMember(), outcome: useRemovalOf("q") }),
      {
        wrapper: function Wrapper(properties: { readonly children: ReactNode }) {
          return <Providers clients={clients}>{properties.children}</Providers>;
        },
      },
    );

    expect(
      result.current.removal,
      "offered before the reader's workspace was read",
    ).toBeUndefined();

    read.resolve();
    await waitFor(() => expect(result.current.removal).toBeDefined());
    act(() => {
      result.current.removal?.mutate({ personId: "q" });
    });

    await waitFor(() => expect(result.current.outcome?.status).toBe("error"));
  });
});

const SURNAME = "Okafor";

const TOM = joined("01JTMK", `Tom ${SURNAME}`, "Viewer");

const SEARCHED = `${MEMBERS}?members.search=${SURNAME}`;

const aTeamPriyaCanBeRemovedFrom = () => {
  const api = anAdminOver([ADA, PRIYA, TOM]);
  api.set("members.remove", () => {
    api.set("members.list", () => readAnswer([ADA, TOM]));
    return readAnswer({});
  });
  return api;
};

const membersListed = (): (string | null)[] =>
  listed()
    .getAllByRole("row")
    .filter((row) => within(row).queryAllByRole("cell").length > 0)
    .map((row) => within(row).getAllByRole("link").at(0)?.textContent ?? null);

const rowMenuOpened = async (name: string): Promise<HTMLElement> => {
  fireEvent.keyDown(await screen.findByRole("button", { name: `Actions for ${name}` }), {
    key: "Enter",
  });
  return screen.findByRole("menu");
};

const jumpedToMember = async (words: string, name: string): Promise<void> => {
  fireEvent.keyDown(document, { key: "k", metaKey: true });
  const input = await screen.findByRole("combobox", { name: JUMP_TO.name });
  await userEvent.setup().type(input, words);
  fireEvent.click(await screen.findByRole("option", { name: new RegExp(name) }));
  await screen.findByRole("heading", { level: 2, name });
};

const stopAt = (target: EventTarget | null): string | null => {
  if (!(target instanceof HTMLElement)) return null;
  return target.localName === "button" ? target.textContent : target.localName;
};

const recordingFocus = () => {
  const stops: (string | null)[] = [];
  const noted = (event: FocusEvent) => {
    stops.push(stopAt(event.target));
  };
  document.addEventListener("focusin", noted);
  return {
    stops,
    stop: () => {
      document.removeEventListener("focusin", noted);
    },
  };
};

const removedOnTheirPage = async (): Promise<void> => {
  const removal = within(await screen.findByRole("region", { name: "Removal" }));
  fireEvent.click(removal.getByRole("button", { name: "Remove Member" }));
  fireEvent.click(removal.getByRole("button", { name: "Remove" }));
};

describe("a removal and jump-to", () => {
  placedWithoutMeasuring();

  it("removing a member opened from jump-to keeps Members' search", async () => {
    const router = await openAt(SEARCHED, aTeamPriyaCanBeRemovedFrom());
    await waitFor(() => expect(membersListed()).toEqual([TOM.displayName]));

    await jumpedToMember("priya", PRIYA.displayName);
    await removedOnTheirPage();

    await waitFor(() => expect(router.state.location.href).toBe(SEARCHED));
    const box = screen.getByRole("searchbox", { name: "Search by name or address" });
    expect(screen.getByDisplayValue(SURNAME)).toBe(box);
    expect(membersListed()).toEqual([TOM.displayName]);
  });

  it("jumping after a removal focuses the page, not Remove", async () => {
    await openAt(MEMBERS, aTeamPriyaCanBeRemovedFrom());
    const menu = await rowMenuOpened(PRIYA.displayName);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Remove" }));
    await screen.findByRole("heading", { level: 2, name: PRIYA.displayName });
    await removedOnTheirPage();
    await waitFor(() => expect(membersListed()).toEqual([ADA.displayName, TOM.displayName]));

    const focus = recordingFocus();
    try {
      await jumpedToMember("tom", TOM.displayName);
      await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("main")));
    } finally {
      focus.stop();
    }

    expect(focus.stops).toContain("main");
    expect(focus.stops, "focus never stops on Remove Member").not.toContain("Remove Member");
  });
});
