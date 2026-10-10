import { useQuery } from "@tanstack/react-query";
import { act, cleanup, fireEvent, renderHook, screen, waitFor } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppClients, Providers, type AppClients } from "@/app/providers.tsx";
import { useChangeRole, useReaderId } from "@/features/people/people-api.ts";
import { HomeLine, useIncludesYou, useSelfActionHome } from "@/features/people/self-action.tsx";
import { useTRPC } from "@/shared/api/trpc.ts";
import { HOMES } from "@/shared/navigation.ts";
import { OutcomeLine, type Outcome } from "@/shared/outcome.tsx";

import { openPages } from "./address-router.tsx";
import { addressOf, answered, answeringAs } from "./stubbed-api.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const wrapperOf = (clients: AppClients) =>
  function Wrapper(properties: { readonly children: ReactNode }) {
    return <Providers clients={clients}>{properties.children}</Providers>;
  };

/** The member read as the frame draws it: one read, mounted across every move between pages. */
function FrameRole() {
  const api = useTRPC();
  const held = useQuery(api.session.member.queryOptions(undefined, { refetchOnMount: false }));
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

/** Members, where the action that included the reader has just succeeded. */
function ActedOnMyself() {
  const { goHome } = useSelfActionHome();
  const [outcome, setOutcome] = useState<Outcome>();

  return (
    <>
      <button
        type="button"
        onClick={() => {
          void goHome("demoted").then(setOutcome);
        }}
      >
        Demoted myself
      </button>
      <button
        type="button"
        onClick={() => {
          void goHome("removed").then(setOutcome);
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
      <HomeLine />
    </>
  );
}

const MEMBERS = "/people/members";

const CHOOSER = "/choose-workspace";

/** The reader, an Admin, on Members with their member read; a failed read is not asked again. */
const actingAt = async () => {
  const clients = createAppClients();
  clients.queryClient.setDefaultOptions({ queries: { retry: false } });
  vi.stubGlobal("fetch", answeringAs("Admin"));
  const opened = await openPages(
    { [MEMBERS]: ActedOnMyself, [HOMES.Editor.path]: Home, [CHOOSER]: Home },
    ["/elsewhere", MEMBERS],
    framedBy(clients),
  );
  await screen.findByText("Held: Admin");
  return { ...opened, clients };
};

/** The chooser's list, as the band's switcher leaves it once its menu has been opened and shut. */
const WORKSPACES_HELD = ["auth", "workspaces"];

/** A search read as an Admin and left behind: no page shows it while People is open. */
const MATCHES_HELD = [
  ["knowledge", "find"],
  { input: { query: "salary bands" }, type: "infinite" },
];

const AS_AN_ADMIN = { pages: [{ matches: [{ title: "Audit Salary Bands" }] }], pageParams: [null] };

/** The reader's own demotion, answered: they are on the Editor's home, having held a search. */
const demotedToEditor = async () => {
  const acting = await actingAt();
  acting.clients.queryClient.setQueryData(MATCHES_HELD, AS_AN_ADMIN);
  vi.stubGlobal("fetch", answeringAs("Editor"));
  fireEvent.click(screen.getByRole("button", { name: "Demoted myself" }));
  await waitFor(() => expect(acting.router.state.location.pathname).toBe(HOMES.Editor.path));
  return acting;
};

/** Ada, an Admin holding a search, whose role change is answered only when the test lets it be. */
const changingARole = async () => {
  const clients = createAppClients();
  clients.queryClient.setDefaultOptions({ queries: { retry: false } });
  const answer = Promise.withResolvers<void>();
  const asAnAdmin = answeringAs("Admin");
  vi.stubGlobal("fetch", async (input: string | URL | Request) => {
    if (!addressOf(input).pathname.includes("members.changeRole")) return asAnAdmin(input);
    await answer.promise;
    return answered([{ result: { data: { changed: true } } }]);
  });
  const people = renderHook(() => ({ change: useChangeRole(), readerId: useReaderId() }), {
    wrapper: wrapperOf(clients),
  });
  await waitFor(() => expect(people.result.current.readerId).toBe("p"));
  clients.queryClient.setQueryData(MATCHES_HELD, AS_AN_ADMIN);
  return { clients, people, answer };
};

describe("an action's confirmation", () => {
  it("says the set includes the reader, and only then", async () => {
    vi.stubGlobal("fetch", answeringAs("Admin"));
    const { result } = renderHook(() => [useIncludesYou(["q", "p"]), useIncludesYou(["q"])], {
      wrapper: wrapperOf(createAppClients()),
    });

    await waitFor(() => expect(result.current[0]).toBe("This includes you."));
    expect(result.current[1]).toBeUndefined();
  });
});

describe("going home after an action on yourself", () => {
  it("sends a self-demoted Admin to an Editor's home, saying why", async () => {
    const { history } = await demotedToEditor();

    expect(screen.getByRole("status").textContent).toBe(
      "You changed your own role to Editor. People is for Admins, so this is your home now.",
    );
    expect(screen.getByText("Held: Editor")).toBeDefined();
    expect(history.length, "the move home pushed an entry of its own").toBe(2);
  });

  it("drops what a self-demoted Admin read before the change", async () => {
    const { clients } = await demotedToEditor();

    expect(
      clients.queryClient.getQueryData(MATCHES_HELD),
      "Search would open on the matches an Admin was shown",
    ).toBeUndefined();
  });

  it("sends a self-removed Admin in no workspace to the chooser", async () => {
    const { router, clients } = await actingAt();
    clients.queryClient.setQueryData(WORKSPACES_HELD, [{ id: "w", name: "The workspace left" }]);

    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("the session has ended")));
    fireEvent.click(screen.getByRole("button", { name: "Removed myself" }));

    await waitFor(() => expect(router.state.location.pathname).toBe(CHOOSER));
    expect(await screen.findByText("Held: none")).toBeDefined();
    expect(
      clients.queryClient.getQueryData(WORKSPACES_HELD),
      "the chooser would open on the workspace left",
    ).toBeUndefined();
  });

  it("stays put, refusing in words, when the role is unread", async () => {
    const { router, clients } = await actingAt();
    clients.queryClient.setQueryData(MATCHES_HELD, AS_AN_ADMIN);

    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("the network is down")));
    fireEvent.click(screen.getByRole("button", { name: "Demoted myself" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "Your role changed, but it couldn’t be read again. Reload the page in a moment.",
      ),
    );
    expect(router.state.location.pathname).toBe(MEMBERS);
    expect(
      screen.getByText("Held: Admin"),
      "the page lost the role it was drawn for",
    ).toBeDefined();
    expect(
      clients.queryClient.getQueryData(MATCHES_HELD),
      "a read from before the change outlived it",
    ).toBeUndefined();
  });
});

describe("a members action that lands after its page has gone", () => {
  it("drops what the reader held when it includes them", async () => {
    const { clients, people, answer } = await changingARole();

    act(() => {
      people.result.current.change.mutate({ personId: "p", role: "Editor" });
    });
    people.unmount();
    answer.resolve();

    await waitFor(() =>
      expect(
        clients.queryClient.getQueryData(MATCHES_HELD),
        "a read made as an Admin outlived the change",
      ).toBeUndefined(),
    );
  });

  it("keeps what the reader held when it is another's", async () => {
    const { clients, people, answer } = await changingARole();

    act(() => {
      people.result.current.change.mutate({ personId: "q", role: "Editor" });
    });
    people.unmount();
    answer.resolve();

    await waitFor(() => expect(clients.queryClient.isMutating()).toBe(0));
    expect(clients.queryClient.getQueryData(MATCHES_HELD)).toEqual(AS_AN_ADMIN);
  });
});
