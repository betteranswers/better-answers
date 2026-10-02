import { cleanup, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { ListRead } from "@/shared/list-pages.tsx";

import { regionsSeen } from "./regions-seen.tsx";

afterEach(cleanup);

const LOADING = "The invitations are still loading.";

const NOTHING = () => undefined;

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
    const { seen, Seen } = regionsSeen("output");

    render(<Seen>{listRead({ error: null, isPending: true })}</Seen>);

    expect(seen[0]).toBe("");
    expect(screen.getByRole("status").textContent).toBe(LOADING);
  });

  it("mounts the failure's alert empty, then says it", () => {
    const { seen, Seen } = regionsSeen("[role=alert]");

    render(<Seen>{listRead({ error: new Error("the network is down"), isPending: false })}</Seen>);

    expect(seen[0]).toBe("");
    expect(screen.getByRole("alert").textContent).toBe("No list: the network is down");
  });

  it("draws the rows once the read has them", () => {
    render(listRead({ error: null, isPending: false }));

    expect(screen.getByText("The rows")).toBeDefined();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
