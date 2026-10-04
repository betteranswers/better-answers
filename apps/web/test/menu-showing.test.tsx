import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RAIL, TOGGLE } from "@/app/words.ts";

import { openApp } from "./open-app.tsx";
import { answeringAs } from "./stubbed-api.ts";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

/** An Admin, so there is an area open for the nav to list. */
const openAt = async (path: string) => {
  vi.stubGlobal("fetch", answeringAs("Admin"));
  return (await openApp(path)).rendered;
};

const closer = () => screen.getByRole("button", { name: TOGGLE.hide });

const opener = () => screen.getByRole("button", { name: TOGGLE.show });

const menu = () => screen.queryByRole("navigation", { name: "Control Centre" });

describe("whether the menu is showing", () => {
  it("shows the nav on a first visit", async () => {
    await openAt("/system/audit-log");

    expect(menu()).not.toBeNull();
    expect(closer().getAttribute("aria-expanded")).toBe("true");
  });

  it("hides the nav and shows it again on one button", async () => {
    await openAt("/system/audit-log");

    fireEvent.click(closer());
    expect(menu()).toBeNull();
    expect(opener().getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(opener());
    expect(menu()).not.toBeNull();
  });

  it("keeps one toggle in the band, nav hidden or shown", async () => {
    await openAt("/system/audit-log");
    const toggle = closer();

    fireEvent.click(toggle);
    expect(opener()).toBe(toggle);
    fireEvent.click(toggle);
    expect(closer()).toBe(toggle);
    expect(screen.getByRole("banner").contains(toggle)).toBe(true);
  });

  it("names the nav as the region the button controls", async () => {
    await openAt("/system/audit-log");

    expect(closer().getAttribute("aria-controls")).toBe(menu()?.id);
  });

  it("remembers the nav closed for the next visit", async () => {
    const first = await openAt("/system/audit-log");
    fireEvent.click(closer());
    first.unmount();

    await openAt("/people/members");

    expect(menu()).toBeNull();
    expect(opener()).toBeDefined();
    expect(screen.getByRole("navigation", { name: RAIL })).toBeDefined();
  });

  it("remembers the nav reopened for the next visit", async () => {
    const first = await openAt("/system/audit-log");
    fireEvent.click(closer());
    fireEvent.click(opener());
    first.unmount();

    await openAt("/system/audit-log");

    expect(menu()).not.toBeNull();
  });
});
