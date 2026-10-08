import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useReadSaid } from "@/shared/read-said.ts";

import { regionsSeen } from "./regions-seen.tsx";

afterEach(cleanup);

const LOADING = "The rows are still loading.";

const REGION = "[aria-live]";

type Read = { readonly error: Error | null; readonly isPending: boolean };

function Region(properties: { readonly read: Read }) {
  const said = useReadSaid(properties.read);
  return (
    <div aria-live="polite">
      {said.isPending ? LOADING : null}
      {said.error === null ? null : `No rows: ${said.error.message}`}
    </div>
  );
}

const PENDING: Read = { error: null, isPending: true };

const FAILED: Read = { error: new Error("the network is down"), isPending: false };

const SETTLED: Read = { error: null, isPending: false };

describe("a read's lines, said after their region mounts", () => {
  it("mounts the region empty, then says the loading line", () => {
    const { seen, Seen } = regionsSeen(REGION);

    render(
      <Seen>
        <Region read={PENDING} />
      </Seen>,
    );

    expect(seen[0]).toBe("");
    expect(seen.at(-1)).toBe(LOADING);
  });

  it("mounts the region empty, then says the failure", () => {
    const { seen, Seen } = regionsSeen(REGION);

    render(
      <Seen>
        <Region read={FAILED} />
      </Seen>,
    );

    expect(seen[0]).toBe("");
    expect(seen.at(-1)).toBe("No rows: the network is down");
  });

  it.each([
    ["loading line", PENDING],
    ["failure", FAILED],
  ])("clears the %s on the commit the read settles", (_, before) => {
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
