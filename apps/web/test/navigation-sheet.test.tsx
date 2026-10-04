import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  NavigationButton,
  NavigationSheet,
  useNavigationSheet,
} from "@/app/navigation-control.tsx";
import { NAVIGATION_SHEET } from "@/app/words.ts";

afterEach(cleanup);

/** Radix hands focus back a task after the sheet goes, so the test lets that task run. */
const aTaskLater = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

/** At an address that is no page, so the wide layout has no navigation control. */
function AtNoPage(properties: { readonly wide: boolean }) {
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
  it("hands focus to the page when widening leaves no control", async () => {
    const { rerender } = render(<AtNoPage wide={false} />);
    fireEvent.click(screen.getByRole("button", { name: NAVIGATION_SHEET }));
    expect(screen.getByRole("dialog", { name: "Menu" })).toBeDefined();

    rerender(<AtNoPage wide />);
    await aTaskLater();

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("main"));
  });
});
