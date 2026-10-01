import { cleanup, isInaccessible, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { BreadcrumbEllipsis } from "@/shared/ui/breadcrumb.tsx";

afterEach(cleanup);

describe("a breadcrumb's ellipsis", () => {
  it("names the parts it stands for to assistive technology", () => {
    render(<BreadcrumbEllipsis />);

    expect(isInaccessible(screen.getByText("More"))).toBe(false);
  });

  it("hides its icon, which the name already says", () => {
    const { container } = render(<BreadcrumbEllipsis />);

    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });
});
