import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppClients, Providers, type AppClients } from "@/app/providers.tsx";
import { useChangeRole, useReaderId } from "@/features/people/people-api.ts";

import { addressOf, answered, answeringAs } from "./stubbed-api.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** A search read as an Admin and left behind: no page shows it while People is open. */
const MATCHES_HELD = [
  ["knowledge", "find"],
  { input: { query: "salary bands" }, type: "infinite" },
];

const AS_AN_ADMIN = { pages: [{ matches: [{ title: "Audit Salary Bands" }] }], pageParams: [null] };

/** Ada, an Admin whose role change is answered only when the test lets it be. */
const changingARole = async () => {
  const clients: AppClients = createAppClients();
  clients.queryClient.setDefaultOptions({ queries: { retry: false } });
  const answer = Promise.withResolvers<void>();
  const asAnAdmin = answeringAs("Admin");
  vi.stubGlobal("fetch", async (input: string | URL | Request) => {
    if (!addressOf(input).pathname.includes("members.changeRole")) return asAnAdmin(input);
    await answer.promise;
    return answered([{ result: { data: { changed: true } } }]);
  });
  const people = renderHook(() => ({ change: useChangeRole(), readerId: useReaderId() }), {
    wrapper: function Wrapper(properties: { readonly children: ReactNode }) {
      return <Providers clients={clients}>{properties.children}</Providers>;
    },
  });
  await waitFor(() => expect(people.result.current.readerId).toBe("p"));
  clients.queryClient.setQueryData(MATCHES_HELD, AS_AN_ADMIN);
  return { clients, people, answer };
};

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
