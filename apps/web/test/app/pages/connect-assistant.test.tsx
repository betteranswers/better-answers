import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import type { BoundFunctions, queries } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CONNECT_ASSISTANT } from "@/app/words.ts";
import { ASK, menuGroupIn, pageNamed } from "@/shared/navigation.ts";
import { STOCK } from "@/shared/refusal-words.ts";
import { clipboardAnswering } from "@test/clipboard-stand-in.ts";
import { openApp } from "@test/open-app.tsx";
import { answeringAs } from "@test/stubbed-api.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const CONNECT_CLAUDE = pageNamed(menuGroupIn(ASK, "ask"), "Connect Claude");

const openConnectClaude = async () => {
  vi.stubGlobal("fetch", answeringAs("Viewer"));
  await openApp(CONNECT_CLAUDE.path);
  return within(await screen.findByRole("main"));
};

const steps = (main: BoundFunctions<typeof queries>) => within(main.getByRole("list"));

describe("Ask › Connect Claude", () => {
  it("lists the steps, including Always allow, and the MCP address", async () => {
    const main = await openConnectClaude();

    expect(
      main.getByRole("heading", { level: 2, name: "Connect Claude as Your Assistant" }),
    ).toBeDefined();
    expect(
      steps(main)
        .getAllByRole("listitem")
        .map((step) => step.firstElementChild?.textContent),
    ).toEqual(CONNECT_ASSISTANT.steps);
    expect(steps(main).getByText(/Always allow/)).toBeDefined();
    expect(main.getByText(`${window.location.origin}/mcp`)).toBeDefined();
    expect(main.getByText(CONNECT_ASSISTANT.asYou)).toBeDefined();
  });

  it("copies the address and confirms it in a status", async () => {
    const clipboardWrites = clipboardAnswering(() => Promise.resolve());
    const main = await openConnectClaude();

    fireEvent.click(main.getByRole("button", { name: "Copy Address" }));

    await vi.waitFor(() => {
      expect(steps(main).getByRole("status").textContent).toBe(CONNECT_ASSISTANT.copied);
    });
    expect(steps(main).getByRole("alert").textContent).toBe("");
    expect(clipboardWrites).toEqual([`${window.location.origin}/mcp`]);
  });

  it("shows an alert when the browser blocks the copy", async () => {
    clipboardAnswering(() => Promise.reject(new Error("refused")));
    const main = await openConnectClaude();

    fireEvent.click(main.getByRole("button", { name: "Copy Address" }));

    await vi.waitFor(() => {
      expect(steps(main).getByRole("alert").textContent).toBe(STOCK.copy);
    });
    expect(steps(main).getByRole("status").textContent).toBe("");
  });
});
