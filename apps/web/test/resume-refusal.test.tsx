import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppClients, Providers } from "@/app/providers.tsx";
import { useOAuthContinue } from "@/features/auth/auth-hooks.ts";

/** Better Auth's client keeps the `fetch` it finds when made, so this one stands first. */
vi.hoisted(() => {
  globalThis.fetch = () =>
    Promise.resolve(
      new Response(JSON.stringify({ code: "FORBIDDEN", message: "refused" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      }),
    );
});

afterEach(cleanup);

describe("a refused resume of a carried connection", () => {
  it("reads in the platform's terms", async () => {
    const clients = createAppClients();
    const wrapper = (properties: { readonly children: ReactNode }) => (
      <Providers clients={clients}>{properties.children}</Providers>
    );
    const { result } = renderHook(useOAuthContinue, { wrapper });

    act(() => result.current.mutate({ postLogin: true }));

    await vi.waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe("answered 403");
  });
});
