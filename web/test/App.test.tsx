import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { App } from "../src/App.tsx";

describe("Control Centre's shell", () => {
  it("names the product to a reader who has just signed in", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "Better Answers" })).toBeDefined();
  });
});
