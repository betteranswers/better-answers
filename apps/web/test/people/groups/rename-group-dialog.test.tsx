import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createAppClients, Providers } from "@/app/providers.tsx";
import type { ListedGroup } from "@/features/people/groups-api.ts";
import { RenameGroupDialog } from "@/features/people/groups/rename-group-dialog.tsx";
import type { Outcome } from "@/shared/outcome.tsx";
import { answeringAs } from "@test/stubbed-api.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const HR_TEAM: ListedGroup = {
  id: z.string().brand<"GroupId">().parse("01K5T000000000000000000001"),
  name: "HR team",
  origin: "admin-curated",
  memberCount: 2,
};

const opened = async () => {
  vi.stubGlobal("fetch", answeringAs("Admin"));
  const onRenamed = vi.fn<(outcome: Outcome) => void>();
  const onClose = vi.fn<() => void>();
  render(
    <Providers clients={createAppClients()}>
      <RenameGroupDialog
        group={HR_TEAM}
        onRenamed={onRenamed}
        onClose={onClose}
        onFocusBack={() => {}}
      />
    </Providers>,
  );
  const dialog = await screen.findByRole("dialog", { name: "Rename HR team" });
  const field = within(dialog).getByRole("textbox", { name: "Name" });
  return { dialog, field, onRenamed, onClose };
};

describe("the row menu's Rename dialog", () => {
  it("says the group already has the name, staying open", async () => {
    const { dialog, field, onRenamed, onClose } = await opened();

    fireEvent.submit(field);

    expect(within(dialog).getByRole("status").textContent).toContain("already called HR team");
    expect(onRenamed).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps a refusal to its own line", async () => {
    const { dialog, field, onRenamed, onClose } = await opened();

    fireEvent.change(field, { target: { value: "People team" } });
    fireEvent.submit(field);

    await waitFor(() => expect(within(dialog).getByRole("alert").textContent).not.toBe(""));
    expect(onRenamed).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
