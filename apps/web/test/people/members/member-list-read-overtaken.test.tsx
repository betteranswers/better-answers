import { fireEvent, screen, waitFor } from "@testing-library/react";
import { assert, describe, expect, it, vi } from "vitest";

import { HOMES } from "@/shared/navigation.ts";
import { placedWithoutMeasuring } from "@test/measuring.ts";
import { heldBack } from "@test/stubbed-api.ts";
import {
  ADA,
  adaAnAdmin,
  changeTheTickedToViewer,
  GRACE,
  openAt,
  openTab,
  read,
  tickOf,
} from "@test/two-workspaces.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

placedWithoutMeasuring();

const gracesRole = (): string | null | undefined =>
  screen.getByRole("link", { name: GRACE.displayName }).closest("tr")?.children[2]?.textContent;

const settled = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 50);
  });

describe("a bulk role change while the list is read again", () => {
  it("keeps its rows through the read it overtook", async () => {
    const api = adaAnAdmin();
    await openAt(HOMES.Admin.path, api);
    await waitFor(() => expect(tickOf(GRACE.displayName)).not.toBeNull());
    const list = heldBack(api, "members.list", read([ADA, GRACE]));
    heldBack(api, "members.bulkChangeRole", read({ changed: [GRACE.personId], skipped: [] }));
    openTab("Invitations");
    openTab("Members");
    await list.asked;

    const tick = tickOf(GRACE.displayName);
    assert(tick !== null, "Grace's row keeps its tick box while the list is read again");
    fireEvent.click(tick);
    await changeTheTickedToViewer();
    await waitFor(() => expect(gracesRole()).toContain("Viewer"));

    list.resolve();
    await settled();

    expect(gracesRole(), "the read in flight wrote over the change").toContain("Viewer");
  });
});
