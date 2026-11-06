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
import { STALE_CONFIRMATION } from "@/features/auth/refusal-words.ts";
import { memberPageOf } from "@/features/people/members/members-address.ts";
import { useRemovalOf, useRemoveMember } from "@/features/people/people-api.ts";
import { placedWithoutMeasuring } from "@test/measuring.ts";
import { anAdminOver, personHeading, thePage } from "@test/people/member-pages.ts";
import { joined, MEMBERS, namesShown, PRIYA, SAM } from "@test/people/members-roster.ts";
import { BOTH_HELD } from "@test/second-factor-api.ts";
import { server } from "@test/stub-server.ts";
import { answeringAs } from "@test/stubbed-api.ts";
import { ADA, aRefusalAnswer, openAt, read as readAnswer } from "@test/two-workspaces.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("removing a member from their page", () => {
  it("offers removal only after your membership loads", async () => {
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
      "removal was offered before your membership loaded",
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
  await screen.findByRole("heading", { level: 1, name });
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

describe("removing a member opened from Jump To", () => {
  placedWithoutMeasuring();

  it("returns to Members with its search kept", async () => {
    const router = await openAt(SEARCHED, aTeamPriyaCanBeRemovedFrom());
    await waitFor(() => expect(namesShown()).toEqual([TOM.displayName]));

    await jumpedToMember("priya", PRIYA.displayName);
    await removedOnTheirPage();

    await waitFor(() => expect(router.state.location.href).toBe(SEARCHED));
    const box = screen.getByRole("searchbox", { name: "Search by name or address" });
    expect(screen.getByDisplayValue(SURNAME)).toBe(box);
    expect(namesShown()).toEqual([TOM.displayName]);
  });

  it("Jump To after a removal focuses the page", async () => {
    await openAt(MEMBERS, aTeamPriyaCanBeRemovedFrom());
    const menu = await rowMenuOpened(PRIYA.displayName);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Remove" }));
    await screen.findByRole("heading", { level: 1, name: PRIYA.displayName });
    await removedOnTheirPage();
    await waitFor(() => expect(namesShown()).toEqual([ADA.displayName, TOM.displayName]));

    const focus = recordingFocus();
    try {
      await jumpedToMember("tom", TOM.displayName);
      await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("main")));
    } finally {
      focus.stop();
    }

    expect(focus.stops).toContain("main");
    expect(focus.stops, "focus passed through Remove Member").not.toContain("Remove Member");
  });
});

describe("removing a member after the confirmation expires", () => {
  it("asks to confirm again once, then removes without asking", async () => {
    const api = anAdminOver([ADA, PRIYA, SAM]);
    const removals = [
      () => aRefusalAnswer(STALE_CONFIRMATION, "precondition", 412),
      () => {
        api.set("members.list", () => readAnswer([ADA, SAM]));
        return readAnswer({});
      },
      () => {
        api.set("members.list", () => readAnswer([ADA]));
        return readAnswer({});
      },
    ];
    api.set("person.secondFactor", () => readAnswer({ ...BOTH_HELD, passkeys: [] }));
    api.set("/second-factor/confirm/authenticator", () => ({ confirmed: true }));
    api.set("members.remove", () => removals.shift()?.());
    const router = await openAt(memberPageOf(PRIYA.personId), api);
    await personHeading("Priya Shah");

    const removal = () => within(thePage().getByRole("region", { name: "Removal" }));
    fireEvent.click(removal().getByRole("button", { name: "Remove Member" }));
    fireEvent.click(await waitFor(() => removal().getByRole("button", { name: "Remove" })));

    const dialog = await screen.findByRole("dialog");
    expect(server.asks.filter((ask) => ask.procedure === "members.remove")).toHaveLength(1);
    expect(router.state.location.pathname).toBe("/people/members");
    fireEvent.change(await within(dialog).findByRole("textbox", { name: "Authenticator Code" }), {
      target: { value: "123456" },
    });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() =>
      expect(server.asks.filter((ask) => ask.procedure === "members.remove")).toHaveLength(2),
    );
    await waitFor(() => expect(screen.queryByRole("link", { name: "Priya Shah" })).toBeNull());

    fireEvent.click(await screen.findByRole("link", { name: "Sam Okoro" }));
    await personHeading("Sam Okoro");
    fireEvent.click(removal().getByRole("button", { name: "Remove Member" }));
    fireEvent.click(await waitFor(() => removal().getByRole("button", { name: "Remove" })));

    await waitFor(() =>
      expect(server.asks.filter((ask) => ask.procedure === "members.remove")).toHaveLength(3),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe("/people/members"));
    expect(screen.queryByRole("link", { name: "Sam Okoro" })).toBeNull();
    expect(
      screen.queryByRole("dialog"),
      "the second removal asked for confirmation again",
    ).toBeNull();
  });
});
