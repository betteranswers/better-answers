import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppClients, Providers, type AppClients } from "@/app/providers.tsx";
import { useSession, useSessionReread, type SessionReread } from "@/features/auth/auth-hooks.ts";

const TOO_MANY_REQUESTS = 429;

/** Better Auth's client keeps the `fetch` it finds when made, so this one stands first. */
const wire = vi.hoisted(() => {
  const answers = { refusing: false };
  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  globalThis.fetch = () =>
    Promise.resolve(
      answers.refusing
        ? json({ code: "TOO_MANY_REQUESTS" }, TOO_MANY_REQUESTS)
        : json(
            { session: { id: "s" }, user: { id: "p", name: "Ada", email: "ada@example.test" } },
            200,
          ),
    );
  return answers;
});

afterEach(cleanup);

const inTheApp =
  (clients: AppClients) =>
  ({ children }: { readonly children: ReactNode }) => (
    <Providers clients={clients}>{children}</Providers>
  );

describe("rereading the session", () => {
  it("reads a refused reread unread, the session still signed in", async () => {
    const { result } = renderHook(() => ({ read: useSession(), reread: useSessionReread() }), {
      wrapper: inTheApp(createAppClients()),
    });
    await vi.waitFor(() => expect(result.current.read.state).toBe("signed-in"));

    wire.refusing = true;
    let reread: SessionReread | undefined;
    await act(async () => {
      reread = await result.current.reread();
    });

    expect(reread).toEqual({ state: "unread" });
    expect(result.current.read.state).toBe("signed-in");
  });
});
