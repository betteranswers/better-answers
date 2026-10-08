import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useRef, useState, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppClients, Providers } from "@/app/providers.tsx";
import { EMPTY_LINES } from "@/features/people/empty-lines.ts";
import {
  MemberBulkActions,
  MemberBulkDialogs,
  useMemberBulkActions,
} from "@/features/people/member-bulk-actions.tsx";
import { OutcomeLine, type Outcome } from "@/shared/outcome.tsx";
import { SelectionBar } from "@/shared/selection-bar.tsx";

import { openPages } from "./address-router.tsx";
import { answeringAs } from "./stubbed-api.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const NOTHING = () => undefined;

const MEMBERS = "/people/members";

const AT_MOST = "Select at most 200 members for one action.";

/** Members' bar and dialogs over `count` ticks, standing in for the table that ticked them. */
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
      mark: NOTHING,
    });
    return (
      <>
        <h1 ref={heading} tabIndex={-1}>
          Members
        </h1>
        <OutcomeLine outcome={outcome} />
        <SelectionBar
          label="Selected members"
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
  await openPages(
    { [MEMBERS]: tickedMembers(count, readable) },
    [MEMBERS],
    function Wrapper(properties: { readonly children: ReactNode }) {
      return <Providers clients={clients}>{properties.children}</Providers>;
    },
  );
};

const ACTIONS = [
  ["Change role", "C"],
  ["Add to group", "G"],
  ["Remove", "D"],
];

describe("the members' bulk actions", () => {
  it.each(ACTIONS)("refuses %s on 201 ticked, opening nothing", async (label) => {
    await ticking(201);

    fireEvent.click(screen.getByRole("button", { name: label }));

    expect(screen.getByText(AT_MOST)).toBeDefined();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it.each(ACTIONS)("refuses %s's Shift+%s on 201 ticked", async (_, key) => {
    await ticking(201);

    fireEvent.keyDown(document.body, { key, shiftKey: true });

    expect(screen.getByText(AT_MOST)).toBeDefined();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens Change role on exactly 200 ticked", async () => {
    await ticking(200);

    fireEvent.click(screen.getByRole("button", { name: "Change role" }));

    expect(
      await screen.findByRole("dialog", { name: "Change the role of 200 members" }),
    ).toBeDefined();
    expect(screen.queryByText(AT_MOST)).toBeNull();
  });

  it("says a failed groups read, never that none exist", async () => {
    await ticking(2);

    fireEvent.click(screen.getByRole("button", { name: "Add to group" }));

    const dialog = await screen.findByRole("dialog", { name: "Add 2 members to a group" });
    await waitFor(() => {
      expect(within(dialog).getByRole("alert").textContent).not.toBe("");
    });
    expect(within(dialog).queryByText(EMPTY_LINES.groups)).toBeNull();
  });

  it.each(["C", "G", "D"])("opens no dialog on Shift+%s while the list is unread", async (key) => {
    await ticking(2, false);

    fireEvent.keyDown(document.body, { key, shiftKey: true });

    // A dialog draws after the press, so its absence is waited on rather than read at once.
    await expect(screen.findByRole("dialog", undefined, { timeout: 300 })).rejects.toThrow(
      'Unable to find role="dialog"',
    );
  });
});
