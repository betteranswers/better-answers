import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppClients, Providers } from "@/app/providers.tsx";
import { CreateGroupAction } from "@/features/people/groups/create-group-action.tsx";
import { GROUP_WORDS } from "@/features/people/groups/group-words.ts";
import { GROUPS_KEYSTROKES } from "@/features/people/people-state.ts";
import { answeringAs } from "@test/stubbed-api.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const NAME = GROUPS_KEYSTROKES.create.action;

const refusedOnce = async () => {
  vi.stubGlobal("fetch", answeringAs("Admin"));
  render(
    <Providers clients={createAppClients()}>
      <CreateGroupAction onCreated={() => {}} />
    </Providers>,
  );
  fireEvent.click(screen.getByRole("button", { name: NAME }));
  const dialog = await screen.findByRole("dialog", { name: NAME });
  const field = within(dialog).getByRole("textbox", { name: GROUP_WORDS.create.field });
  fireEvent.change(field, { target: { value: "HR team" } });
  fireEvent.submit(field);
  await waitFor(() => expect(within(dialog).getByRole("alert").textContent).not.toBe(""));
};

describe("the Create a Group dialog", () => {
  it("reopens by keystroke with no alert after a refusal", async () => {
    await refusedOnce();
    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.keyDown(document.body, { key: GROUPS_KEYSTROKES.create.key });

    const reopened = await screen.findByRole("dialog", { name: NAME });
    expect(within(reopened).getByRole("alert").textContent).toBe("");
  });
});
