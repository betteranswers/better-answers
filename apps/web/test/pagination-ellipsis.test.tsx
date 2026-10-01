import { cleanup, isInaccessible, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PaginationEllipsis } from "@/shared/ui/pagination.tsx";

afterEach(cleanup);

describe("a pagination's ellipsis", () => {
  it("names the pages it stands for to assistive technology", () => {
    render(<PaginationEllipsis />);

    expect(isInaccessible(screen.getByText("More pages"))).toBe(false);
  });

  it("hides its icon, which the name already says", () => {
    const { container } = render(<PaginationEllipsis />);

    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });
});
