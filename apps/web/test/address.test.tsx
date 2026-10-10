import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Address } from "@/shared/address.tsx";

afterEach(cleanup);

const drawn = (address: string) => {
  const { container } = render(<Address address={address} />);
  return container;
};

/** The text before each break the part allows, so a test reads where an address may wrap. */
const breaksAfter = (container: HTMLElement): string[] =>
  [...container.querySelectorAll("wbr")].map((wbr) => wbr.previousSibling?.textContent ?? "");

describe("an address on a page", () => {
  it("reads as the address itself", () => {
    expect(drawn("hollis.reed@example.test").textContent).toBe("hollis.reed@example.test");
  });

  it("may break after the @ and each dot, nowhere else", () => {
    expect(breaksAfter(drawn("hollis.reed@example.test"))).toEqual([
      "hollis.",
      "reed@",
      "example.",
    ]);
  });

  it("offers no break where there is no @ or dot", () => {
    const container = drawn("localhost");

    expect(container.textContent).toBe("localhost");
    expect(breaksAfter(container)).toEqual([]);
  });

  it("draws an empty address as nothing", () => {
    const container = drawn("");

    expect(container.textContent).toBe("");
    expect(breaksAfter(container)).toEqual([]);
  });
});
