import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useRef, useState, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppClients, Providers } from "@/app/providers.tsx";
import { EMPTY_LINES } from "@/features/people/empty-lines.ts";
import { BULK_WORDS } from "@/features/people/member-action-words.ts";
import {
  MemberBulkActions,
  MemberBulkDialogs,
  useMemberBulkActions,
} from "@/features/people/members/member-bulk-actions.tsx";
import { createApiProxy } from "@/shared/api/trpc.ts";
import { SelectionBar } from "@/shared/list/selection-bar.tsx";
import { memberOptions } from "@/shared/member/member.ts";
import { OutcomeLine, type Outcome } from "@/shared/outcome.tsx";
import { openPages } from "@test/address-router.tsx";
import { placedWithoutMeasuring } from "@test/measuring.ts";
import { asked, listed, outcome as listOutcome, PRIYA, SAM } from "@test/people/members-roster.ts";
import { answeringAs } from "@test/stubbed-api.ts";
import { ADA, adaAnAdmin, openAt, read } from "@test/two-workspaces.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const NOTHING = () => undefined;

const MEMBERS = "/people/members";

const AT_MOST = BULK_WORDS.tooMany(200);

const tickedMembers = (count: number, readable: boolean) =>
  function TickedMembers() {
    const [ticked, tick] = useState<ReadonlySet<string>>(
      () => new Set(Array.from({ length: count }, (_, index) => `person-${String(index)}`)),
    );
    const [outcome, say] = useState<Outcome>();
    const heading = useRef<HTMLHeadingElement>(null);
    const actions = useMemberBulkActions({
      readable,
      ticked,
      tick,
      nameOf: (personId) => personId,
      heading,
      say,
    });
    return (
      <>
        <h1 ref={heading} tabIndex={-1}>
          Members
        </h1>
        <OutcomeLine outcome={outcome} />
        <SelectionBar
          label="Selected Members"
          ticked={ticked}
          shown={[]}
          noun={["member", "members"]}
          onClear={NOTHING}
          focusAfterClear={heading}
        >
          <MemberBulkActions actions={actions} />
        </SelectionBar>
        <MemberBulkDialogs actions={actions} />
      </>
    );
  };

const ticking = async (count: number, readable = true) => {
  const clients = createAppClients();
  clients.queryClient.setDefaultOptions({ queries: { retry: false } });
  vi.stubGlobal("fetch", answeringAs("Admin"));
  await clients.queryClient.query(
    memberOptions(createApiProxy(clients.apiClient, clients.queryClient)),
  );
  await openPages(
    { [MEMBERS]: tickedMembers(count, readable) },
    [MEMBERS],
    function Wrapper(properties: { readonly children: ReactNode }) {
      return <Providers clients={clients}>{properties.children}</Providers>;
    },
  );
};

const ACTIONS = [
  ["Change Role", "C"],
  ["Add to Group", "G"],
  ["Remove", "D"],
];

describe("the members' bulk actions", () => {
  it.each(ACTIONS)("refuses %s on 201 ticked, opening nothing", async (label) => {
    await ticking(201);

    fireEvent.click(screen.getByRole("button", { name: label }));

    expect(screen.getByText(AT_MOST).textContent).toMatch(/\b200\b/v);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it.each(ACTIONS)("refuses %s's Shift+%s on 201 ticked", async (_, key) => {
    await ticking(201);

    fireEvent.keyDown(document.body, { key, shiftKey: true });

    expect(screen.getByText(AT_MOST)).toBeDefined();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens Change Role on exactly 200 ticked", async () => {
    await ticking(200);

    fireEvent.click(screen.getByRole("button", { name: "Change Role" }));

    expect(
      await screen.findByRole("dialog", { name: "Change Role for 200 Members" }),
    ).toBeDefined();
    expect(screen.queryByText(AT_MOST)).toBeNull();
  });

  it("says a failed groups read, never that none exist", async () => {
    await ticking(2);

    fireEvent.click(screen.getByRole("button", { name: "Add to Group" }));

    const dialog = await screen.findByRole("dialog", { name: "Add 2 Members to a Group" });
    await waitFor(() => {
      expect(within(dialog).getByRole("alert").textContent).not.toBe("");
    });
    expect(within(dialog).queryByText(EMPTY_LINES.groups)).toBeNull();
  });

  it.each(["C", "G", "D"])("opens no dialog on Shift+%s while the list is unread", async (key) => {
    await ticking(2, false);

    fireEvent.keyDown(document.body, { key, shiftKey: true });

    await expect(screen.findByRole("dialog", undefined, { timeout: 300 })).rejects.toThrow(
      'Unable to find role="dialog"',
    );
  });
});

describe("the members' bulk Remove", () => {
  placedWithoutMeasuring();

  it("bulk Remove names the count and opens on Cancel", async () => {
    const api = adaAnAdmin();
    api.set("members.list", () => read([ADA, PRIYA, SAM]));
    api.set("members.bulkRemove", () => {
      api.set("members.list", () => read([ADA]));
      return read({ changed: [PRIYA.personId, SAM.personId], skipped: 0 });
    });
    await openAt(MEMBERS, api);
    for (const member of [PRIYA, SAM]) {
      fireEvent.click(
        await screen.findByRole("checkbox", { name: `Select ${member.displayName}` }),
      );
    }
    const remove = within(screen.getByRole("toolbar", { name: "Selected Members" })).getByRole(
      "button",
      { name: "Remove" },
    );
    act(() => {
      remove.focus();
    });

    fireEvent.click(remove);

    const dialog = await screen.findByRole("dialog", { name: "Remove 2 Members" });
    await waitFor(() => {
      expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Cancel" }));
    });
    expect(
      screen.getByRole("dialog", { name: "Remove 2 Members", description: /\S/ }),
      "the dialog describes what removing does",
    ).toBe(dialog);
    expect(
      within(dialog).getAllByRole("paragraph"),
      "a line warns two others as it would the reader",
    ).toHaveLength(1);

    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(remove);
    });
    expect(asked("members.bulkRemove"), "Escape asked the api to remove").toEqual([]);
    for (const member of [ADA, PRIYA, SAM]) {
      expect(listed().getByRole("link", { name: member.displayName })).toBeDefined();
    }

    fireEvent.click(remove);
    const again = await screen.findByRole("dialog", { name: "Remove 2 Members" });
    fireEvent.click(within(again).getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(listOutcome()?.textContent).not.toBe(BULK_WORDS.remove.pending(2));
    });
    expect(listOutcome()?.textContent, "the outcome counts two removed, and none skipped").toMatch(
      /^\D*2\D*$/,
    );
    await waitFor(() => {
      expect(listed().queryByRole("link", { name: PRIYA.displayName })).toBeNull();
    });
    expect(listed().queryByRole("link", { name: SAM.displayName })).toBeNull();
    expect(listed().getByRole("link", { name: ADA.displayName })).toBeDefined();
    await waitFor(() => {
      expect(document.activeElement).toBe(
        listed().getByRole("heading", { level: 2, name: "Members" }),
      );
    });
    expect(asked("members.bulkRemove")).toEqual([
      expect.objectContaining({ personIds: [PRIYA.personId, SAM.personId] }),
    ]);
  });
});
