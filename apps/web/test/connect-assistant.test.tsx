import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ADDRESS_NOT_COPIED, CONNECT_ASSISTANT, unbuiltLineOf } from "@/app/words.ts";
import { HOMES } from "@/shared/navigation.ts";
import { sentenceOf } from "@/shared/refusal-words.ts";

import { clipboardAnswering } from "./clipboard-stand-in.ts";
import { openApp } from "./open-app.tsx";
import { answeringAs } from "./stubbed-api.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const askOpened = async () => {
  vi.stubGlobal("fetch", answeringAs("Viewer"));
  await openApp(HOMES.Viewer.path);
  return within(await screen.findByRole("main"));
};

/** The page holds other status regions, so the copy's outcome is read inside the steps. */
const steps = (main: ReturnType<typeof within>) => within(main.getByRole("list"));

describe("Ask while it is unbuilt", () => {
  it("names the steps and the address it is served from", async () => {
    const main = await askOpened();

    expect(main.getByText(unbuiltLineOf(HOMES.Viewer))).toBeDefined();
    expect(main.getByRole("heading", { level: 2, name: CONNECT_ASSISTANT.heading })).toBeDefined();
    expect(
      steps(main)
        .getAllByRole("listitem")
        .map((step) => step.firstElementChild?.textContent),
    ).toEqual(CONNECT_ASSISTANT.steps);
    expect(main.getByText(`${window.location.origin}/mcp`)).toBeDefined();
    expect(main.getByText(CONNECT_ASSISTANT.asYou)).toBeDefined();
  });

  it("copies the address and says it was copied", async () => {
    const written = clipboardAnswering(() => Promise.resolve());
    const main = await askOpened();

    fireEvent.click(main.getByRole("button", { name: CONNECT_ASSISTANT.copy }));

    await vi.waitFor(() => {
      expect(steps(main).getByRole("status").textContent).toBe(CONNECT_ASSISTANT.copied);
    });
    expect(written).toEqual([`${window.location.origin}/mcp`]);
  });

  it("says what to do when the browser refuses the copy", async () => {
    clipboardAnswering(() => Promise.reject(new Error("refused")));
    const main = await askOpened();

    fireEvent.click(main.getByRole("button", { name: CONNECT_ASSISTANT.copy }));

    await vi.waitFor(() => {
      expect(steps(main).getByRole("alert").textContent).toBe(sentenceOf(ADDRESS_NOT_COPIED));
    });
    expect(steps(main).getByRole("status").textContent).toBe("");
  });
});
