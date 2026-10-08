import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppClients, Providers } from "@/app/providers.tsx";
import { useRemovalOf, useRemoveMember } from "@/features/people/people-api.ts";

import { answeringAs } from "./stubbed-api.ts";

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

    // The stub refuses every action, so the removal ends refused rather than lost.
    await waitFor(() => expect(result.current.outcome?.status).toBe("error"));
  });
});
