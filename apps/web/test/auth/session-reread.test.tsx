import { act, cleanup, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppClients, Providers, type AppClients } from "@/app/providers.tsx";
import { useSession, useSessionReread, type SessionReread } from "@/features/auth/auth-hooks.ts";
import { DISPLAY_NAME_WORDS } from "@/shared/member/display-name-words.ts";
import { openApp } from "@test/open-app.tsx";

const TOO_MANY_REQUESTS = 429;

/** Better Auth's client keeps the `fetch` it sees when created, so the stub is hoisted above the imports. */
const wire = vi.hoisted(() => {
  const answers = { refusing: false, reads: 0 };
  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  globalThis.fetch = (asked) => {
    const address =
      typeof asked === "string" ? asked : asked instanceof URL ? asked.href : asked.url;
    const readsTheSession = new URL(address, "http://app.test").pathname === "/get-session";
    if (readsTheSession) answers.reads += 1;
    return Promise.resolve(
      answers.refusing && readsTheSession
        ? json({ code: "TOO_MANY_REQUESTS" }, TOO_MANY_REQUESTS)
        : json(
            { session: { id: "s" }, user: { id: "p", name: "Ada", email: "ada@example.test" } },
            200,
          ),
    );
  };
  return answers;
});

afterEach(() => {
  cleanup();
  wire.refusing = false;
  wire.reads = 0;
});

const inTheApp =
  (clients: AppClients) =>
  ({ children }: { readonly children: ReactNode }) => (
    <Providers clients={clients}>{children}</Providers>
  );

describe("rereading the session", () => {
  it("a refused reread keeps the session signed in", async () => {
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

  it("does not retry a refused session read", async () => {
    wire.refusing = true;
    const clients = createAppClients();
    const { queries, ...held } = clients.queryClient.getDefaultOptions();
    clients.queryClient.setDefaultOptions({ ...held, queries: { ...queries, retryDelay: 0 } });

    await openApp("/display-name", clients);

    expect(
      await screen.findByRole("heading", { level: 1, name: DISPLAY_NAME_WORDS.heading }),
    ).toBeDefined();
    expect(wire.reads, "a refused session read was asked again").toBe(1);
  });
});
