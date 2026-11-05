import { cleanup, isInaccessible, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { BreadcrumbEllipsis } from "@/shared/ui/breadcrumb.tsx";

afterEach(cleanup);

describe("a breadcrumb's ellipsis", () => {
  it("has an accessible name for screen readers", () => {
    render(<BreadcrumbEllipsis />);

    expect(isInaccessible(screen.getByText("More"))).toBe(false);
  });

  it("hides its icon from screen readers", () => {
    const { container } = render(<BreadcrumbEllipsis />);

    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });
});
