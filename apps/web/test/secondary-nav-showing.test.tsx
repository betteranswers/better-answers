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
  it("opens showing it, because that is the shell a first visit should meet", async () => {
    await openAt("/system/health");

    expect(secondaryNav()).not.toBeNull();
    expect(closer().getAttribute("aria-expanded")).toBe("true");
  });

  it("takes the nav away on the button and gives it back on the same button", async () => {
    await openAt("/system/health");

    fireEvent.click(closer());
    expect(secondaryNav()).toBeNull();
    expect(opener().getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(opener());
    expect(secondaryNav()).not.toBeNull();
  });

  it("names the region it governs, so the button and the nav are one control and one thing", async () => {
    await openAt("/system/health");

    expect(closer().getAttribute("aria-controls")).toBe(secondaryNav()?.id);
  });

  it("remembers the nav closed, so the next visit opens without it", async () => {
    const first = await openAt("/system/health");
    fireEvent.click(closer());
    first.unmount();

    await openAt("/people/owners");

    expect(screen.queryByRole("navigation", { name: "People" })).toBeNull();
    expect(opener()).toBeDefined();
    expect(screen.getByRole("navigation", { name: "Control Centre" })).toBeDefined();
  });

  it("remembers the nav opened again, so closing it once is not forever", async () => {
    const first = await openAt("/system/health");
    fireEvent.click(closer());
    fireEvent.click(opener());
    first.unmount();

    await openAt("/system/health");

    expect(secondaryNav()).not.toBeNull();
  });
});
