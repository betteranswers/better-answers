import { useQuery } from "@tanstack/react-query";
import { cleanup, fireEvent, renderHook, screen, waitFor } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppClients, Providers, type AppClients } from "@/app/providers.tsx";
import { LandedLine, useIncludesYou, useSelfActLanding } from "@/features/people/self-act.tsx";
import { useTRPC } from "@/shared/api/trpc.ts";
import { HOMES } from "@/shared/navigation.ts";
import { OutcomeLine, type Outcome } from "@/shared/outcome.tsx";

import { openScreens } from "./address-router.tsx";
import { answeringAs } from "./stubbed-api.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const wrapperOf = (clients: AppClients) =>
  function Wrapper(properties: { readonly children: ReactNode }) {
    return <Providers clients={clients}>{properties.children}</Providers>;
  };

/** The membership as the frame draws it: one read, mounted across every move between screens. */
function FrameRole() {
  const api = useTRPC();
  const held = useQuery(api.session.membership.queryOptions(undefined, { refetchOnMount: false }));
  return <p>{`Held: ${held.data?.role ?? "none"}`}</p>;
}

const framedBy = (clients: AppClients) =>
  function Framed(properties: { readonly children: ReactNode }) {
    return (
      <Providers clients={clients}>
        <FrameRole />
        {properties.children}
      </Providers>
    );
  };

/** Members, where the act that included the reader has just succeeded. */
function ActedOnMyself() {
  const { land } = useSelfActLanding();
  const [outcome, setOutcome] = useState<Outcome>();

  return (
    <>
      <button
        type="button"
        onClick={() => {
          void land("demoted").then(setOutcome);
        }}
      >
        Demoted myself
      </button>
      <button
        type="button"
        onClick={() => {
          void land("removed").then(setOutcome);
        }}
      >
        Removed myself
      </button>
      <OutcomeLine outcome={outcome} />
    </>
  );
}

function Home() {
  return (
    <>
      <h1>Home</h1>
      <LandedLine />
    </>
  );
}

const MEMBERS = "/people/members";

/** The reader, an Admin, on Members with their membership read; a failed read is not asked again. */
const actingAt = async () => {
  const clients = createAppClients();
  clients.queryClient.setDefaultOptions({ queries: { retry: false } });
  vi.stubGlobal("fetch", answeringAs("Admin"));
  const opened = await openScreens(
    { [MEMBERS]: ActedOnMyself, [HOMES.Editor.path]: Home, "/": Home },
    ["/elsewhere", MEMBERS],
    framedBy(clients),
  );
  await screen.findByText("Held: Admin");
  return opened;
};

describe("an act's confirmation", () => {
  it("says the set includes the reader, and only then", async () => {
    vi.stubGlobal("fetch", answeringAs("Admin"));
    const { result } = renderHook(() => [useIncludesYou(["q", "p"]), useIncludesYou(["q"])], {
      wrapper: wrapperOf(createAppClients()),
    });

    await waitFor(() => expect(result.current[0]).toBe("This includes you."));
    expect(result.current[1]).toBeUndefined();
  });
});

describe("landing after an act on yourself", () => {
  it("lands a self-demoted Admin on an Editor's home, saying why", async () => {
    const { router, history } = await actingAt();

    vi.stubGlobal("fetch", answeringAs("Editor"));
    fireEvent.click(screen.getByRole("button", { name: "Demoted myself" }));

    await waitFor(() => expect(router.state.location.pathname).toBe(HOMES.Editor.path));
    expect(screen.getByRole("status").textContent).toBe(
      "You changed your own role to Editor. People is for Admins, so this is your home now.",
    );
    expect(screen.getByText("Held: Editor")).toBeDefined();
    expect(history.length, "the landing pushed an entry of its own").toBe(2);
  });

  it("lands a self-removed Admin on /, holding no membership", async () => {
    const { router } = await actingAt();

    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("the session has ended")));
    fireEvent.click(screen.getByRole("button", { name: "Removed myself" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(await screen.findByText("Held: none")).toBeDefined();
  });

  it("stays put, refusing in words, when the role is unread", async () => {
    const { router } = await actingAt();

    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("the network is down")));
    fireEvent.click(screen.getByRole("button", { name: "Demoted myself" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "Your role changed, but it couldn't be read again. Reload the page in a moment.",
      ),
    );
    expect(router.state.location.pathname).toBe(MEMBERS);
    expect(
      screen.getByText("Held: Admin"),
      "the screen lost the role it was drawn for",
    ).toBeDefined();
  });
});
