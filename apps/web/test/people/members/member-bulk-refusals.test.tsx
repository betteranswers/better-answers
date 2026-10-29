import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BULK_WORDS, NO_LONGER_LISTED } from "@/features/people/member-action-words.ts";
import { placedWithoutMeasuring } from "@test/measuring.ts";
import { asked, listed, outcome, PRIYA, rowOf, SAM } from "@test/people/members-roster.ts";
import { heldBack } from "@test/stubbed-api.ts";
import { ADA, adaAnAdmin, GRACE, openAt, read } from "@test/two-workspaces.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

placedWithoutMeasuring();

const MEMBERS = "/people/members";

const TWO_TICKED_ONE_HIDDEN = /\b2\b\D+\b1\b/;

const refusedAs = (
  word: string,
  refusalClass: string,
  httpStatus: number,
  items?: Readonly<Record<string, string>>,
) => ({
  error: {
    message: word,
    code: -32_001,
    data: { code: "REFUSED", httpStatus, refusal: { word, class: refusalClass, items } },
  },
});

const changedMeanwhile = (items?: Readonly<Record<string, string>>) =>
  refusedAs("changed-meanwhile", "conflict", 409, items);

const apiOf = (...members: readonly object[]) => {
  const api = adaAnAdmin();
  api.set("members.list", () => read(members));
  return api;
};

const bar = () => within(screen.getByRole("toolbar", { name: "Selected Members" }));

const listHeading = () => listed().getByRole("heading", { level: 2, name: "Members" });

const roleOf = (name: string): string | undefined =>
  within(rowOf(name)).getAllByRole("cell").at(2)?.textContent;

const tickOf = (name: string): HTMLElement =>
  listed().getByRole("checkbox", { name: `Select ${name}` });

const ticking = async (...names: readonly string[]) => {
  for (const name of names) {
    fireEvent.click(await screen.findByRole("checkbox", { name: `Select ${name}` }));
  }
};

const refusal = () => listed().getByRole("alert");

const refusedLines = (name: string): HTMLElement[] =>
  within(refusal())
    .queryAllByRole("listitem")
    .filter((line) => line.textContent.includes(name));

const searchBox = () => screen.getByRole("searchbox", { name: "Search by name or address" });

const changeRoleOpened = async (title: string): Promise<HTMLElement> => {
  fireEvent.click(bar().getByRole("button", { name: "Change Role" }));
  const dialog = await screen.findByRole("dialog", { name: title });
  await waitFor(() => {
    expect(document.activeElement).toBe(within(dialog).getByRole("combobox", { name: "Role" }));
  });
  return dialog;
};

const changeRoleSent = (dialog: HTMLElement) => {
  fireEvent.click(within(dialog).getByRole("button", { name: "Change Role" }));
};

const removedThroughTheBar = async (title: string) => {
  fireEvent.click(bar().getByRole("button", { name: "Remove" }));
  const dialog = await screen.findByRole("dialog", { name: title });
  fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
};

const removalOfPriyaHeld = async () => {
  const api = apiOf(ADA, PRIYA, SAM);
  const removal = heldBack(api, "members.remove", read({}));
  await openAt(MEMBERS, api);
  fireEvent.click(await screen.findByRole("link", { name: PRIYA.displayName }));
  fireEvent.click(await screen.findByRole("button", { name: "Remove Member" }));
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  await waitFor(() => {
    expect(outcome()?.textContent).toContain(PRIYA.displayName);
  });
  return { api, removal };
};

describe("bulk actions on the members ticked", () => {
  it("names a refused person whose row the search hides", async () => {
    const api = adaAnAdmin();
    api.set("members.bulkChangeRole", () =>
      refusedAs("last-admin", "precondition", 412, {
        [ADA.personId]: "last-admin",
        [GRACE.personId]: "last-admin",
      }),
    );
    await openAt(MEMBERS, api);
    await ticking(ADA.displayName, GRACE.displayName);
    fireEvent.change(searchBox(), { target: { value: GRACE.displayName } });
    await waitFor(() => {
      expect(listed().queryByRole("link", { name: ADA.displayName })).toBeNull();
    });
    expect(bar().getByRole("status").textContent).toMatch(TWO_TICKED_ONE_HIDDEN);

    const dialog = await changeRoleOpened("Change Role for 2 Members");
    changeRoleSent(dialog);

    await waitFor(() => {
      expect(refusedLines(ADA.displayName)).toHaveLength(1);
    });
    expect(bar().getByRole("status").textContent).toMatch(TWO_TICKED_ONE_HIDDEN);
    await waitFor(() => {
      expect(document.activeElement).toBe(listHeading());
    });
    fireEvent.keyDown(listHeading(), { key: "Escape" });
    expect(screen.queryByRole("toolbar", { name: "Selected Members" })).toBeNull();
    fireEvent.change(searchBox(), { target: { value: "" } });
    expect(await screen.findByRole("link", { name: ADA.displayName })).toBeDefined();
    expect(tickOf(ADA.displayName).getAttribute("aria-checked")).toBe("false");
  });

  it("a person removed meanwhile stays ticked, named, until Remove skips", async () => {
    const api = apiOf(ADA, PRIYA, SAM);
    api.set("members.bulkChangeRole", () => {
      api.set("members.list", () => read([ADA, PRIYA]));
      return refusedAs("no-such-member", "not-found", 404, { [SAM.personId]: "no-such-member" });
    });
    api.set("members.bulkRemove", () => {
      api.set("members.list", () => read([ADA]));
      return read({ changed: [PRIYA.personId], skipped: 1 });
    });
    await openAt(MEMBERS, api);
    await ticking(PRIYA.displayName, SAM.displayName);

    const refusedAsNoMember = async () => {
      const dialog = await changeRoleOpened("Change Role for 2 Members");
      changeRoleSent(dialog);
      await waitFor(() => {
        expect(refusal().textContent).not.toBe("");
      });
      expect(within(refusal()).getByText(BULK_WORDS.refused(1))).toBeDefined();
      expect(within(refusal()).getAllByRole("listitem")).toHaveLength(1);
      expect(tickOf(PRIYA.displayName).getAttribute("aria-checked")).toBe("true");
      expect(roleOf(PRIYA.displayName)).toContain("Editor");
    };

    await refusedAsNoMember();
    expect(asked("members.bulkChangeRole")).toEqual([
      expect.objectContaining({ personIds: [PRIYA.personId, SAM.personId] }),
    ]);
    expect(within(refusal()).getByRole("listitem").textContent).toContain(SAM.displayName);
    await waitFor(() => {
      expect(listed().queryByRole("link", { name: SAM.displayName })).toBeNull();
    });
    expect(bar().getByRole("status").textContent).toMatch(TWO_TICKED_ONE_HIDDEN);

    await refusedAsNoMember();
    expect(
      within(refusal()).getByRole("listitem").textContent,
      "a member no longer listed is refused by the name they had",
    ).toContain(NO_LONGER_LISTED);
    expect(within(refusal()).getByRole("listitem").textContent).not.toContain(SAM.displayName);
    expect(bar().getByRole("status").textContent).toMatch(TWO_TICKED_ONE_HIDDEN);

    await removedThroughTheBar("Remove 2 Members");
    await waitFor(() => {
      expect(outcome()?.textContent, "the outcome counts one removed and one skipped").toBe(
        BULK_WORDS.remove.done(1, 1),
      );
    });
    await waitFor(() => {
      expect(listed().queryByRole("link", { name: PRIYA.displayName })).toBeNull();
    });
  });

  it("a set answered changed-meanwhile comes back with its ticks", async () => {
    const api = apiOf(ADA, PRIYA, SAM);
    api.set("members.bulkChangeRole", () => changedMeanwhile());
    await openAt(MEMBERS, api);
    await ticking(PRIYA.displayName, SAM.displayName);

    const dialog = await changeRoleOpened("Change Role for 2 Members");
    changeRoleSent(dialog);

    await waitFor(() => {
      expect(refusal().textContent, "the alert says nothing").not.toBe("");
    });
    expect(asked("members.bulkChangeRole")).toEqual([
      expect.objectContaining({ personIds: [PRIYA.personId, SAM.personId] }),
    ]);
    expect(document.body.textContent).not.toContain("changed-meanwhile");
    expect(tickOf(PRIYA.displayName).getAttribute("aria-checked")).toBe("true");
    expect(tickOf(SAM.displayName).getAttribute("aria-checked")).toBe("true");
    expect(roleOf(PRIYA.displayName)).toContain("Editor");
  });

  it("a tick made mid-act survives the bulk refusal", async () => {
    const api = apiOf(ADA, PRIYA, SAM);
    const removal = heldBack(api, "members.bulkRemove");
    await openAt(MEMBERS, api);
    await ticking(PRIYA.displayName);
    await removedThroughTheBar("Remove 1 Member");
    await removal.asked;
    await waitFor(() => {
      expect(screen.queryByRole("toolbar", { name: "Selected Members" })).toBeNull();
    });
    await ticking(SAM.displayName);

    removal.reject(changedMeanwhile());

    await waitFor(() => {
      expect(refusal().textContent, "the alert says nothing").not.toBe("");
    });
    expect(removal.asks).toBe(1);
    await waitFor(() => {
      expect(
        tickOf(PRIYA.displayName).getAttribute("aria-checked"),
        "the pressed tick returns",
      ).toBe("true");
    });
    expect(
      tickOf(SAM.displayName).getAttribute("aria-checked"),
      "the tick made meanwhile stays",
    ).toBe("true");
  });

  it("a removal refused after a bulk answer still says why", async () => {
    const { api, removal } = await removalOfPriyaHeld();
    api.set("members.bulkChangeRole", () =>
      read({ changed: [SAM.personId], skipped: 0, promoted: [] }),
    );

    await ticking(SAM.displayName);
    const dialog = await changeRoleOpened("Change Role for 1 Member");
    changeRoleSent(dialog);
    await waitFor(() => {
      expect(outcome()?.textContent, "the bulk act answers first").toBe(
        BULK_WORDS.changeRole.done(1, "Viewer", 0),
      );
    });

    removal.reject(changedMeanwhile());

    await waitFor(() => {
      expect(refusal().textContent, "the alert says nothing").not.toBe("");
    });
    expect(outcome()?.textContent, "the status still says Priya is being removed").not.toContain(
      PRIYA.displayName,
    );
    expect(listed().getByRole("link", { name: PRIYA.displayName })).toBeDefined();
  });

  it("a removal's late refusal clears a bulk refusal's row marks", async () => {
    const { api, removal } = await removalOfPriyaHeld();
    api.set("members.bulkChangeRole", () => changedMeanwhile({ [SAM.personId]: "no-such-member" }));
    await ticking(SAM.displayName);
    const dialog = await changeRoleOpened("Change Role for 1 Member");
    changeRoleSent(dialog);
    await waitFor(() => {
      expect(within(rowOf(SAM.displayName)).getByText("Refused")).toBeDefined();
    });

    removal.reject(changedMeanwhile());

    await waitFor(() => {
      expect(
        within(rowOf(SAM.displayName)).queryByText("Refused"),
        "the removal's words leave no row marked",
      ).toBeNull();
    });
  });
});
