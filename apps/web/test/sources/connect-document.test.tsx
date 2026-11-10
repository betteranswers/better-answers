import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CONNECT_WORDS } from "@/features/sources/words.ts";
import { placedWithoutMeasuring } from "@test/measuring.ts";
import { anAdminWith, openSources, press } from "@test/stubbed-sources.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

placedWithoutMeasuring();

describe("connecting a document on the Sources page", () => {
  it("refuses an unsupported file and keeps the dialog open", async () => {
    await openSources(anAdminWith());
    press("b");
    const dialog = await screen.findByRole("dialog", { name: CONNECT_WORDS.action });
    const picture = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "shopfront.png", {
      type: "image/png",
    });
    const name = within(dialog).getByLabelText("Name");
    fireEvent.change(name, { target: { value: "Shop photographs" } });
    fireEvent.change(within(dialog).getByLabelText("File"), { target: { files: [picture] } });

    fireEvent.submit(name);

    await waitFor(() => {
      expect(within(dialog).getByRole("alert").textContent).toMatch(/\S/v);
    });
    expect(document.body.textContent, "the page shows the word media-type-refused").not.toContain(
      "media-type-refused",
    );
    expect(dialog.isConnected).toBe(true);
  });
});
