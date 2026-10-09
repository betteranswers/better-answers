import { cleanup, render, screen } from "@testing-library/react";
import { createRef, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppClients, Providers } from "@/app/providers.tsx";
import { MEMBERS_LOADING } from "@/features/people/member-action-words.ts";
import { MembersTab } from "@/features/people/members-tab.tsx";
import { ListRead, ListState } from "@/shared/list-pages.tsx";

import { openPages } from "./address-router.tsx";
import { regionsSeen } from "./regions-seen.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const LOADING = "The invitations are still loading.";

const NOTHING = () => undefined;

/** The list's own region, not the count line or the outcome line beside it. */
const LIST_REGION = "[data-slot=empty-title] output";

const listRead = (read: { readonly error: Error | null; readonly isPending: boolean }) => (
  <ListRead
    read={{ ...read, refetch: NOTHING }}
    loading={LOADING}
    failed={(failure) => `No list: ${failure.message}`}
    focusAfterRetry={createRef<HTMLElement>()}
  >
    <p>The rows</p>
  </ListRead>
);

describe("a list's state, said after its region mounts", () => {
  it("mounts the loading region empty, then says its line", () => {
    const { seen, Seen } = regionsSeen("output");

    render(
      <Seen>
        <ListState state={{ kind: "loading", words: LOADING }} />
      </Seen>,
    );

    expect(seen[0]).toBe("");
    expect(screen.getByRole("status").textContent).toBe(LOADING);
  });

  it("mounts the failure's alert empty, then says the failure", () => {
    const { seen, Seen } = regionsSeen("[role=alert]");

    render(
      <Seen>
        <ListState
          state={{
            kind: "failed",
            words: "The members could not be read.",
            onRetry: NOTHING,
            focusAfterRetry: createRef<HTMLElement>(),
          }}
        />
      </Seen>,
    );

    expect(seen[0]).toBe("");
    expect(screen.getByRole("alert").textContent).toBe("The members could not be read.");
  });

  it("draws the loading region while a read is pending", () => {
    render(listRead({ error: null, isPending: true }));

    expect(screen.getByRole("status").textContent).toBe(LOADING);
  });

  it("draws a failed read's alert in place of the rows", () => {
    render(listRead({ error: new Error("the network is down"), isPending: false }));

    expect(screen.getByRole("alert").textContent).toBe("No list: the network is down");
    expect(screen.queryByText("The rows")).toBeNull();
  });

  it("draws the rows once the read has them", () => {
    render(listRead({ error: null, isPending: false }));

    expect(screen.getByText("The rows")).toBeDefined();
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("Members' loading line, said after its region mounts", () => {
  it("mounts Members' loading region empty while the read is pending", async () => {
    vi.stubGlobal("fetch", () => new Promise<Response>(() => undefined));
    const { seen, Seen } = regionsSeen(LIST_REGION);
    const wrapper = (properties: { readonly children: ReactNode }) => (
      <Providers clients={createAppClients()}>
        <Seen>{properties.children}</Seen>
      </Providers>
    );

    await openPages({ "/people/members": MembersTab }, ["/people/members"], wrapper);

    expect(seen.find((said) => said !== undefined)).toBe("");
    expect(document.querySelector(LIST_REGION)?.textContent).toBe(MEMBERS_LOADING);
  });
});
