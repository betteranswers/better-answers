import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  BULK_WORDS,
  MEMBER_PAGE_WORDS,
  SELECTED_MEMBERS,
} from "@/features/people/member-action-words.ts";
import { placedWithoutMeasuring } from "@test/measuring.ts";
import { asked, listed, outcome, PRIYA, rowOf, SAM } from "@test/people/members-roster.ts";
import { holdProcedure } from "@test/stubbed-api.ts";
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

const bar = () => within(screen.getByRole("toolbar", { name: SELECTED_MEMBERS }));

const listHeading = () => listed().getByRole("heading", { level: 2, name: "Members" });

const roleOf = (name: string): string | undefined =>
  within(rowOf(name)).getAllByRole("cell").at(2)?.textContent;

const personCell = (name: string): string | undefined =>
  within(rowOf(name)).getAllByRole("cell").at(1)?.textContent;

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
  fireEvent.click(bar().getByRole("button", { name: MEMBER_PAGE_WORDS.changeRole }));
  const dialog = await screen.findByRole("dialog", { name: title });
  await waitFor(() => {
    expect(document.activeElement).toBe(within(dialog).getByRole("combobox", { name: "Role" }));
  });
  return dialog;
};

const changeRoleSent = (dialog: HTMLElement) => {
  fireEvent.click(within(dialog).getByRole("button", { name: MEMBER_PAGE_WORDS.changeRole }));
};

const removedThroughTheBar = async (title: string) => {
  fireEvent.click(bar().getByRole("button", { name: "Remove" }));
  const dialog = await screen.findByRole("dialog", { name: title });
  fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
};

const removalOfPriyaHeld = async () => {
  const api = apiOf(ADA, PRIYA, SAM);
  const removal = holdProcedure(api, "members.remove", read({}));
  await openAt(MEMBERS, api);
  fireEvent.click(await screen.findByRole("link", { name: PRIYA.displayName }));
  fireEvent.click(await screen.findByRole("button", { name: MEMBER_PAGE_WORDS.removeMember }));
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  await waitFor(() => {
    expect(outcome()?.textContent).toContain(PRIYA.displayName);
  });
  return { api, removal };
};

describe("bulk actions on selected members", () => {
  it("names a refused member that the search hides", async () => {
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

    const dialog = await changeRoleOpened(BULK_WORDS.changeRole.title(2));
    changeRoleSent(dialog);

    await waitFor(() => {
      expect(refusedLines(ADA.displayName)).toHaveLength(1);
    });
    expect(bar().getByRole("status").textContent).toMatch(TWO_TICKED_ONE_HIDDEN);
    await waitFor(() => {
      expect(document.activeElement).toBe(listHeading());
    });
    fireEvent.keyDown(listHeading(), { key: "Escape" });
    expect(screen.queryByRole("toolbar", { name: SELECTED_MEMBERS })).toBeNull();
    fireEvent.change(searchBox(), { target: { value: "" } });
    expect(await screen.findByRole("link", { name: ADA.displayName })).toBeDefined();
    expect(tickOf(ADA.displayName).getAttribute("aria-checked")).toBe("false");
  });

  it("keeps a removed member selected until bulk Remove skips them", async () => {
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
      const dialog = await changeRoleOpened(BULK_WORDS.changeRole.title(2));
      changeRoleSent(dialog);
      await waitFor(() => {
        expect(refusal().textContent).not.toBe("");
      });
      expect(
        within(refusal()).getByRole("paragraph").textContent,
        "the refusal did not count one member",
      ).toMatch(/\b1\b/);
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
      "the refusal line for the removed member is empty",
    ).toMatch(/\S/);
    expect(within(refusal()).getByRole("listitem").textContent).not.toContain(SAM.displayName);
    expect(bar().getByRole("status").textContent).toMatch(TWO_TICKED_ONE_HIDDEN);

    await removedThroughTheBar(BULK_WORDS.remove.title(2));
    await waitFor(() => {
      expect(
        outcome()?.textContent,
        "the outcome did not count one removed and one skipped",
      ).toMatch(/\b1\b\D+\b1\b/);
    });
    await waitFor(() => {
      expect(listed().queryByRole("link", { name: PRIYA.displayName })).toBeNull();
    });
  });

  it("keeps the selection when the members changed during the action", async () => {
    const api = apiOf(ADA, PRIYA, SAM);
    api.set("members.bulkChangeRole", () => changedMeanwhile());
    await openAt(MEMBERS, api);
    await ticking(PRIYA.displayName, SAM.displayName);

    const dialog = await changeRoleOpened(BULK_WORDS.changeRole.title(2));
    changeRoleSent(dialog);

    await waitFor(() => {
      expect(refusal().textContent, "the alert is empty").not.toBe("");
    });
    expect(asked("members.bulkChangeRole")).toEqual([
      expect.objectContaining({ personIds: [PRIYA.personId, SAM.personId] }),
    ]);
    expect(document.body.textContent).not.toContain("changed-meanwhile");
    expect(tickOf(PRIYA.displayName).getAttribute("aria-checked")).toBe("true");
    expect(tickOf(SAM.displayName).getAttribute("aria-checked")).toBe("true");
    expect(roleOf(PRIYA.displayName)).toContain("Editor");
  });

  it("a selection made during an action stays after a refusal", async () => {
    const api = apiOf(ADA, PRIYA, SAM);
    const removal = holdProcedure(api, "members.bulkRemove");
    await openAt(MEMBERS, api);
    await ticking(PRIYA.displayName);
    await removedThroughTheBar(BULK_WORDS.remove.title(1));
    await removal.asked;
    await waitFor(() => {
      expect(screen.queryByRole("toolbar", { name: SELECTED_MEMBERS })).toBeNull();
    });
    await ticking(SAM.displayName);

    removal.reject(changedMeanwhile());

    await waitFor(() => {
      expect(refusal().textContent, "the alert is empty").not.toBe("");
    });
    expect(removal.asks).toBe(1);
    await waitFor(() => {
      expect(
        tickOf(PRIYA.displayName).getAttribute("aria-checked"),
        "the first selection was not restored",
      ).toBe("true");
    });
    expect(
      tickOf(SAM.displayName).getAttribute("aria-checked"),
      "the selection made during the action was cleared",
    ).toBe("true");
  });

  it("a removal refused after a bulk change shows an alert", async () => {
    const { api, removal } = await removalOfPriyaHeld();
    api.set("members.bulkChangeRole", () =>
      read({ changed: [SAM.personId], skipped: 0, promoted: [] }),
    );

    await ticking(SAM.displayName);
    const dialog = await changeRoleOpened(BULK_WORDS.changeRole.title(1));
    changeRoleSent(dialog);
    await waitFor(() => {
      expect(
        outcome()?.textContent,
        "the bulk change's message did not replace the removal's",
      ).toMatch(/\bViewer\b/);
    });

    removal.reject(changedMeanwhile());

    await waitFor(() => {
      expect(refusal().textContent, "the alert is empty").not.toBe("");
    });
    expect(outcome()?.textContent, "the status still says Priya is being removed").not.toContain(
      PRIYA.displayName,
    );
    expect(listed().getByRole("link", { name: PRIYA.displayName })).toBeDefined();
  });

  it("a late removal refusal clears the marks on refused rows", async () => {
    const { api, removal } = await removalOfPriyaHeld();
    api.set("members.bulkChangeRole", () => changedMeanwhile({ [SAM.personId]: "no-such-member" }));
    await ticking(SAM.displayName);
    const unmarked = personCell(SAM.displayName);
    const dialog = await changeRoleOpened(BULK_WORDS.changeRole.title(1));
    changeRoleSent(dialog);
    await waitFor(() => {
      expect(personCell(SAM.displayName), "the refused row was not marked").not.toBe(unmarked);
    });

    removal.reject(changedMeanwhile());

    await waitFor(() => {
      expect(
        personCell(SAM.displayName),
        "the refused row stayed marked after the removal's refusal",
      ).toBe(unmarked);
    });
  });
});
