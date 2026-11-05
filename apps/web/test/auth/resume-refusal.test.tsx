import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppClients, Providers } from "@/app/providers.tsx";
import { useOAuthContinue } from "@/features/auth/auth-hooks.ts";

/** Better Auth's client keeps the `fetch` it sees when created, so the stub is hoisted above the imports. */
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

describe("resuming a connection the api refuses after sign-in", () => {
  it("fails with the app's own error, not the auth library's", async () => {
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
