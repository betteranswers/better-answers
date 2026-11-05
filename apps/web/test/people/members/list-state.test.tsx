import { cleanup, render, screen } from "@testing-library/react";
import { createRef, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppClients, Providers } from "@/app/providers.tsx";
import { MembersTab } from "@/features/people/members/members-tab.tsx";
import { ListRead, ListState } from "@/shared/list/list-pages.tsx";
import { openPages } from "@test/address-router.tsx";
import { regionsSeen } from "@test/regions-seen.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const LOADING = "The invitations are still loading.";

const FAILED = "The members could not be read.";

const DOWN = new Error("the network is down");

const failedSaid = (failure: Error): string => `No list: ${failure.message}`;

const NOTHING = () => undefined;

const LIST_REGION = "[data-slot=empty-title] output";

const listRead = (read: { readonly error: Error | null; readonly isPending: boolean }) => (
  <ListRead
    read={{ ...read, refetch: NOTHING }}
    loading={LOADING}
    failed={failedSaid}
    focusAfterRetry={createRef<HTMLElement>()}
  >
    <p>The rows</p>
  </ListRead>
);

describe("a list's status regions, filled after they mount", () => {
  it("mounts the loading region empty, then fills it", () => {
    const { seen, Seen } = regionsSeen("output");

    render(
      <Seen>
        <ListState state={{ kind: "loading", words: LOADING }} />
      </Seen>,
    );

    expect(seen[0]).toBe("");
    expect(screen.getByRole("status").textContent).toBe(LOADING);
  });

  it("mounts the failure alert empty, then fills it", () => {
    const { seen, Seen } = regionsSeen("[role=alert]");

    render(
      <Seen>
        <ListState
          state={{
            kind: "failed",
            words: FAILED,
            onRetry: NOTHING,
            focusAfterRetry: createRef<HTMLElement>(),
          }}
        />
      </Seen>,
    );

    expect(seen[0]).toBe("");
    expect(screen.getByRole("alert").textContent).toBe(FAILED);
  });

  it("shows the loading region while a read is pending", () => {
    render(listRead({ error: null, isPending: true }));

    expect(screen.getByRole("status").textContent).toBe(LOADING);
  });

  it("shows a failed read's alert instead of the rows", () => {
    render(listRead({ error: DOWN, isPending: false }));

    expect(screen.getByRole("alert").textContent).toBe(failedSaid(DOWN));
    expect(screen.queryByText("The rows")).toBeNull();
  });

  it("mounts the alert empty when a pending read fails", () => {
    const { seen, Seen } = regionsSeen("[role=alert]");
    const { rerender } = render(<Seen>{listRead({ error: null, isPending: true })}</Seen>);
    const before = seen.length;

    rerender(<Seen>{listRead({ error: DOWN, isPending: false })}</Seen>);

    expect(seen.slice(before).find((said) => said !== undefined)).toBe("");
    expect(screen.getByRole("alert").textContent).toBe(failedSaid(DOWN));
  });

  it("shows the rows once the read finishes", () => {
    render(listRead({ error: null, isPending: false }));

    expect(screen.getByText("The rows")).toBeDefined();
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("the Members loading message", () => {
  it("mounts its region empty, then shows the message", async () => {
    vi.stubGlobal("fetch", () => new Promise<Response>(() => undefined));
    const { seen, Seen } = regionsSeen(LIST_REGION);
    const wrapper = (properties: { readonly children: ReactNode }) => (
      <Providers clients={createAppClients()}>
        <Seen>{properties.children}</Seen>
      </Providers>
    );

    await openPages({ "/people/members": MembersTab }, ["/people/members"], wrapper);

    expect(seen.find((said) => said !== undefined)).toBe("");
    expect(document.querySelector(LIST_REGION)?.textContent).toMatch(/\S/);
  });
});
