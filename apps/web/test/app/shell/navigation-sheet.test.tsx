import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  NavigationButton,
  NavigationSheet,
  useNavigationSheet,
} from "@/app/shell/navigation-control.tsx";

afterEach(cleanup);

/** Radix restores focus one task after the sheet closes. */
const nextTask = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

function NavigationWithoutAreas(properties: { readonly wide: boolean }) {
  const sheet = useNavigationSheet();

  return (
    <>
      <NavigationButton
        sheet={sheet}
        wide={properties.wide}
        showing
        controls="menu"
        open={undefined}
        onShow={() => undefined}
      />
      <NavigationSheet sheet={sheet} wide={properties.wide} areas={[]} open={undefined} />
      <main tabIndex={-1} />
    </>
  );
}

describe("the navigation sheet", () => {
  it("moves focus to the page when widening removes its button", async () => {
    const { rerender } = render(<NavigationWithoutAreas wide={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    expect(screen.getByRole("dialog", { name: "Menu" })).toBeDefined();

    rerender(<NavigationWithoutAreas wide />);
    await nextTask();

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("main"));
  });
});
