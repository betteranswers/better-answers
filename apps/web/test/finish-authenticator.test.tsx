import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppClients, Providers, type AppClients } from "@/app/providers.tsx";
import { useFinishAuthenticator } from "@/features/auth/second-factor-hooks.ts";

import { answered } from "./stubbed-api.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const CODES = ["abcd-efgh-jkmn-pqrs", "tvwx-yz01-2345-6789"];

const wrapperOf = (clients: AppClients) =>
  function Wrapper(properties: { readonly children: ReactNode }) {
    return <Providers clients={clients}>{properties.children}</Providers>;
  };

describe("finishing the authenticator's setup", () => {
  it("hands over the codes after the code field has gone", async () => {
    const answer = Promise.withResolvers<void>();
    const asked = vi.fn<() => Promise<Response>>(async () => {
      await answer.promise;
      return answered({ recoveryCodes: CODES });
    });
    vi.stubGlobal("fetch", asked);
    const handed: (readonly string[] | null)[] = [];
    const { result, unmount } = renderHook(
      () =>
        useFinishAuthenticator((codes) => {
          handed.push(codes);
        }),
      { wrapper: wrapperOf(createAppClients()) },
    );

    act(() => {
      result.current.mutate("123456");
    });
    await waitFor(() => {
      expect(asked).toHaveBeenCalledOnce();
    });
    unmount();
    answer.resolve();

    await waitFor(() => {
      expect(handed).toEqual([CODES]);
    });
  });
});
