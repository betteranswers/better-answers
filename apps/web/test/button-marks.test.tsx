import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button } from "@/shared/ui/button.tsx";

const marked = (name: string) => screen.getByRole("button", { name }).hasAttribute("data-marks");

describe("the button's registration marks", () => {
  it("marks the primary at 32px and up, and nothing else", () => {
    render(
      <>
        <Button>Primary</Button>
        <Button size="sm">Small primary</Button>
        <Button size="lg">Large primary</Button>
        <Button size="xs">Tiny primary</Button>
        <Button size="icon" aria-label="Icon primary" />
        <Button variant="accent">Accent</Button>
        <Button variant="outline">Outline</Button>
      </>,
    );

    expect(
      [
        "Primary",
        "Small primary",
        "Large primary",
        "Tiny primary",
        "Icon primary",
        "Accent",
        "Outline",
      ].map(marked),
    ).toEqual([true, true, true, false, false, false, false]);
  });
});
