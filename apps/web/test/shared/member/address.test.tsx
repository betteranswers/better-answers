import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Address } from "@/shared/member/address.tsx";

afterEach(cleanup);

const renderAddress = (address: string) => {
  const { container } = render(<Address address={address} />);
  return container;
};

const breaksAfter = (container: HTMLElement): string[] =>
  [...container.querySelectorAll("wbr")].map((wbr) => wbr.previousSibling?.textContent ?? "");

describe("an email address", () => {
  it("shows the address text unchanged", () => {
    expect(renderAddress("hollis.reed@example.test").textContent).toBe("hollis.reed@example.test");
  });

  it("allows line breaks only after the @ and each dot", () => {
    expect(breaksAfter(renderAddress("hollis.reed@example.test"))).toEqual([
      "hollis.",
      "reed@",
      "example.",
    ]);
  });

  it("adds no line breaks without an @ or dot", () => {
    const container = renderAddress("localhost");

    expect(container.textContent).toBe("localhost");
    expect(breaksAfter(container)).toEqual([]);
  });

  it("renders nothing for an empty address", () => {
    const container = renderAddress("");

    expect(container.textContent).toBe("");
    expect(breaksAfter(container)).toEqual([]);
  });
});
