import { cleanup, isInaccessible, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PaginationEllipsis } from "@/shared/ui/pagination.tsx";

afterEach(cleanup);

describe("a pagination's ellipsis", () => {
  it("has an accessible name for screen readers", () => {
    render(<PaginationEllipsis />);

    expect(isInaccessible(screen.getByText("More pages"))).toBe(false);
  });

  it("hides its icon from screen readers", () => {
    const { container } = render(<PaginationEllipsis />);

    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });
});
