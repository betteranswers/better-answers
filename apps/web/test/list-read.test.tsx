import { cleanup, render, screen } from "@testing-library/react";
import { createRef, useLayoutEffect } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { ListRead } from "@/shared/list-pages.tsx";

afterEach(cleanup);

const LOADING = "The invitations are still loading.";

const NOTHING = () => undefined;

/** What each commit left in the live region a role names, the first commit's included. */
const regionsSeen = (selector: string) => {
  const seen: (string | undefined)[] = [];
  function Probe() {
    useLayoutEffect(() => {
      seen.push(document.querySelector(selector)?.textContent ?? undefined);
    });
    return null;
  }
  return { seen, Probe };
};

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

describe("a list's read, said after its region mounts (BA-31)", () => {
  it("mounts the loading region empty, then says the line", () => {
    const { seen, Probe } = regionsSeen("output");

    render(
      <>
        {listRead({ error: null, isPending: true })}
        <Probe />
      </>,
    );

    expect(seen[0]).toBe("");
    expect(screen.getByRole("status").textContent).toBe(LOADING);
  });

  it("mounts the failure's alert empty, then says it", () => {
    const { seen, Probe } = regionsSeen("[role=alert]");

    render(
      <>
        {listRead({ error: new Error("the network is down"), isPending: false })}
        <Probe />
      </>,
    );

    expect(seen[0]).toBe("");
    expect(screen.getByRole("alert").textContent).toBe("No list: the network is down");
  });

  it("draws the rows once the read has them", () => {
    render(listRead({ error: null, isPending: false }));

    expect(screen.getByText("The rows")).toBeDefined();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
