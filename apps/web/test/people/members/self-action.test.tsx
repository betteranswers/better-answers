import { act, cleanup, fireEvent, renderHook, screen, waitFor } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppClients, Providers, type AppClients } from "@/app/providers.tsx";
import {
  HomeLine,
  useIncludesYou,
  useSelfActionHome,
} from "@/features/people/members/self-action.tsx";
import { useChangeRole, useReaderId } from "@/features/people/people-api.ts";
import { createApiProxy } from "@/shared/api/trpc.ts";
import { useMember } from "@/shared/member/member.ts";
import { HOMES } from "@/shared/navigation.ts";
import { OutcomeLine, type Outcome } from "@/shared/outcome.tsx";
import { openPages } from "@test/address-router.tsx";
import { addressOf, answered, answeringAs } from "@test/stubbed-api.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const wrapperOf = (clients: AppClients) =>
  function Wrapper(properties: { readonly children: ReactNode }) {
    return <Providers clients={clients}>{properties.children}</Providers>;
  };

function FrameRole() {
  const held = useMember();
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

const workspacesHeldIn = (clients: AppClients) =>
  createApiProxy(clients.apiClient, clients.queryClient).person.workspaces.queryKey();

const MATCHES_HELD = [
  ["knowledge", "find"],
  { input: { query: "salary bands" }, type: "infinite" },
];

const AS_AN_ADMIN = { pages: [{ matches: [{ title: "Audit Salary Bands" }] }], pageParams: [null] };

const demotedToEditor = async () => {
  const acting = await actingAt();
  acting.clients.queryClient.setQueryData(MATCHES_HELD, AS_AN_ADMIN);
  vi.stubGlobal("fetch", answeringAs("Editor"));
  fireEvent.click(screen.getByRole("button", { name: "Demoted myself" }));
  await waitFor(() => expect(acting.router.state.location.pathname).toBe(HOMES.Editor.path));
  return acting;
};

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

describe("a bulk confirmation's note about you", () => {
  it("adds a note only when the selection includes you", async () => {
    vi.stubGlobal("fetch", answeringAs("Admin"));
    const { result } = renderHook(() => [useIncludesYou(["q", "p"]), useIncludesYou(["q"])], {
      wrapper: wrapperOf(createAppClients()),
    });

    await waitFor(() => expect(result.current[0]).toMatch(/\S/));
    expect(result.current[1]).toBeUndefined();
  });
});

describe("going home after an action on yourself", () => {
  it("sends a demoted Admin to the Editor home page", async () => {
    const { history } = await demotedToEditor();

    expect(screen.getByRole("status").textContent).toContain("Editor");
    expect(screen.getByText("Held: Editor")).toBeDefined();
    expect(history.length, "the move home added a history entry").toBe(2);
  });

  it("clears results a demoted Admin loaded before the change", async () => {
    const { clients } = await demotedToEditor();

    expect(
      clients.queryClient.getQueryData(MATCHES_HELD),
      "Search still holds results loaded as an Admin",
    ).toBeUndefined();
  });

  it("sends a removed Admin with no workspace to the chooser", async () => {
    const { router, clients } = await actingAt();
    const held = workspacesHeldIn(clients);
    clients.queryClient.setQueryData(held, []);

    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("the session has ended")));
    fireEvent.click(screen.getByRole("button", { name: "Removed myself" }));

    await waitFor(() => expect(router.state.location.pathname).toBe(CHOOSER));
    expect(await screen.findByText("Held: none")).toBeDefined();
    expect(
      clients.queryClient.getQueryData(held),
      "the chooser still lists the workspace that was left",
    ).toBeUndefined();
  });

  it("alerts and stays put if the role cannot load", async () => {
    const { router, clients } = await actingAt();
    clients.queryClient.setQueryData(MATCHES_HELD, AS_AN_ADMIN);

    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("the network is down")));
    fireEvent.click(screen.getByRole("button", { name: "Demoted myself" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/\S/));
    expect(screen.getByRole("status").textContent).toBe("");
    expect(router.state.location.pathname).toBe(MEMBERS);
    expect(screen.getByText("Held: Admin"), "the page lost the Admin role it showed").toBeDefined();
    expect(
      clients.queryClient.getQueryData(MATCHES_HELD),
      "results loaded before the change were kept",
    ).toBeUndefined();
  });
});

describe("a role change that finishes after its page closes", () => {
  it("clears cached results when the change is to your role", async () => {
    const { clients, people, answer } = await changingARole();

    act(() => {
      people.result.current.change.mutate({ personId: "p", role: "Editor" });
    });
    people.unmount();
    answer.resolve();

    await waitFor(() =>
      expect(
        clients.queryClient.getQueryData(MATCHES_HELD),
        "results loaded as an Admin were kept after the change",
      ).toBeUndefined(),
    );
  });

  it("keeps cached results when the change is to another member", async () => {
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
