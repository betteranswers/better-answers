import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useReadSaid } from "@/shared/read-said.ts";
import { regionsSeen } from "@test/regions-seen.tsx";

afterEach(cleanup);

const LOADING = "The rows are still loading.";

const REGION = "[aria-live]";

const DOWN = new Error("the network is down");

const failureText = (failure: Error): string => `No rows: ${failure.message}`;

type Read = { readonly error: Error | null; readonly isPending: boolean };

function Region(properties: { readonly read: Read }) {
  const state = useReadSaid(properties.read);
  return (
    <div aria-live="polite">
      {state.isPending ? LOADING : null}
      {state.error === null ? null : failureText(state.error)}
    </div>
  );
}

const PENDING: Read = { error: null, isPending: true };

const FAILED: Read = { error: DOWN, isPending: false };

const SETTLED: Read = { error: null, isPending: false };

describe("a read's live region messages", () => {
  it("mounts empty, then shows the loading message", () => {
    const { seen, Seen } = regionsSeen(REGION);

    render(
      <Seen>
        <Region read={PENDING} />
      </Seen>,
    );

    expect(seen[0]).toBe("");
    expect(seen.at(-1)).toBe(LOADING);
  });

  it("mounts empty, then shows the failure message", () => {
    const { seen, Seen } = regionsSeen(REGION);

    render(
      <Seen>
        <Region read={FAILED} />
      </Seen>,
    );

    expect(seen[0]).toBe("");
    expect(seen.at(-1)).toBe(failureText(DOWN));
  });

  it.each([
    ["loading message", PENDING],
    ["failure message", FAILED],
  ])("clears the %s on the settling render", (_, before) => {
    const { seen, Seen } = regionsSeen(REGION);
    const { rerender } = render(
      <Seen>
        <Region read={before} />
      </Seen>,
    );
    const settledFrom = seen.length;

    rerender(
      <Seen>
        <Region read={SETTLED} />
      </Seen>,
    );

    expect(seen.length).toBeGreaterThan(settledFrom);
    expect(seen.slice(settledFrom).filter((text) => text !== "")).toEqual([]);
  });
});
