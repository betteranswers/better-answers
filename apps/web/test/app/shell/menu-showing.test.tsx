import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TOGGLE } from "@/app/words.ts";
import { openApp } from "@test/open-app.tsx";
import { answeringAs } from "@test/stubbed-api.ts";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

const openAt = async (path: string) => {
  vi.stubGlobal("fetch", answeringAs("Admin"));
  return (await openApp(path)).rendered;
};

const hideButton = () => screen.getByRole("button", { name: TOGGLE.hide });

const showButton = () => screen.getByRole("button", { name: TOGGLE.show });

const menu = () => screen.queryByRole("navigation", { name: "Control Centre" });

describe("whether the menu is showing", () => {
  it("shows the nav on a first visit", async () => {
    await openAt("/system/audit-log");

    expect(menu()).not.toBeNull();
    expect(hideButton().getAttribute("aria-expanded")).toBe("true");
  });

  it("hides the nav and shows it again on one button", async () => {
    await openAt("/system/audit-log");

    fireEvent.click(hideButton());
    expect(menu()).toBeNull();
    expect(showButton().getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(showButton());
    expect(menu()).not.toBeNull();
  });

  it("uses one band button to hide and show the nav", async () => {
    await openAt("/system/audit-log");
    const toggle = hideButton();

    fireEvent.click(toggle);
    expect(showButton()).toBe(toggle);
    fireEvent.click(toggle);
    expect(hideButton()).toBe(toggle);
    expect(screen.getByRole("banner").contains(toggle)).toBe(true);
  });

  it("points the toggle's aria-controls at the nav", async () => {
    await openAt("/system/audit-log");

    expect(hideButton().getAttribute("aria-controls")).toBe(menu()?.id);
  });

  it("remembers the nav closed for the next visit", async () => {
    const first = await openAt("/system/audit-log");
    fireEvent.click(hideButton());
    first.unmount();

    await openAt("/people/members");

    expect(menu()).toBeNull();
    expect(showButton()).toBeDefined();
    expect(screen.getByRole("navigation", { name: "Areas" })).toBeDefined();
  });

  it("remembers the nav reopened for the next visit", async () => {
    const first = await openAt("/system/audit-log");
    fireEvent.click(hideButton());
    fireEvent.click(showButton());
    first.unmount();

    await openAt("/system/audit-log");

    expect(menu()).not.toBeNull();
  });
});
