import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { openApp } from "./open-app.tsx";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const openAt = async (path: string) => (await openApp(path)).rendered;

const closer = () => screen.getByRole("button", { name: "Hide the secondary nav" });

const opener = () => screen.getByRole("button", { name: "Show the secondary nav" });

const secondaryNav = () => screen.queryByRole("navigation", { name: "System" });

describe("whether the secondary nav is showing", () => {
  it("shows the nav on a first visit", async () => {
    await openAt("/system/health");

    expect(secondaryNav()).not.toBeNull();
    expect(closer().getAttribute("aria-expanded")).toBe("true");
  });

  it("hides the nav and shows it again on one button", async () => {
    await openAt("/system/health");

    fireEvent.click(closer());
    expect(secondaryNav()).toBeNull();
    expect(opener().getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(opener());
    expect(secondaryNav()).not.toBeNull();
  });

  it("names the nav as the region the button controls", async () => {
    await openAt("/system/health");

    expect(closer().getAttribute("aria-controls")).toBe(secondaryNav()?.id);
  });

  it("remembers the nav closed for the next visit", async () => {
    const first = await openAt("/system/health");
    fireEvent.click(closer());
    first.unmount();

    await openAt("/people/owners");

    expect(screen.queryByRole("navigation", { name: "People" })).toBeNull();
    expect(opener()).toBeDefined();
    expect(screen.getByRole("navigation", { name: "Control Centre" })).toBeDefined();
  });

  it("remembers the nav reopened for the next visit", async () => {
    const first = await openAt("/system/health");
    fireEvent.click(closer());
    fireEvent.click(opener());
    first.unmount();

    await openAt("/system/health");

    expect(secondaryNav()).not.toBeNull();
  });
});
