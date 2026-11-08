import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { COLLECTIONS_WORDS as WORDS } from "@/features/knowledge/knowledge-words.ts";
import { KNOWLEDGE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";
import { placedWithoutMeasuring } from "@test/measuring.ts";
import { holdProcedure } from "@test/stubbed-api.ts";
import {
  ADA,
  adaAnAdmin,
  aRefusalAnswer,
  GRACE,
  NORTHERN,
  openAt,
  read,
} from "@test/two-workspaces.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

placedWithoutMeasuring();

const PAGE = pageNamed(menuGroupIn(KNOWLEDGE, "curation"), "Collections and Owners").path;

const RHIAN = { ...GRACE, personId: "01JRHIAN0000000000000000AA", displayName: "Rhian Pryce" };

const PICKER = new RegExp(`^${WORDS.newOwner}\\s?${WORDS.ofCollection("policy").trim()}$`, "u");

const SAVE = new RegExp(`^${WORDS.save}\\s?${WORDS.saveOf("policy").trim()}$`, "u");

const POLICY = { collection: "policy", owner: null, overrides: 0 };

const region = () => within(screen.getByRole("region", { name: "Collections and Owners" }));

const policyRow = () =>
  within(
    region().getByRole("heading", { level: 3, name: "policy" }).closest("li") ?? document.body,
  );

describe("the Collections and Owners page", () => {
  it("restores the old owner and alerts when the api refuses", async () => {
    const api = adaAnAdmin();
    api.set("members.list", () => read([ADA, RHIAN]));
    api.set("knowledge.collections", () => read({ collections: [POLICY] }));
    api.set("knowledge.nameOwner", () => {
      api.set("members.list", () => read([ADA]));
      return aRefusalAnswer("no-such-member", "precondition", 412);
    });
    await openAt(PAGE, api);

    const picker = await screen.findByRole("combobox", { name: PICKER });
    const reread = holdProcedure(api, "knowledge.collections");
    fireEvent.change(picker, { target: { value: RHIAN.personId } });
    fireEvent.click(screen.getByRole("button", { name: SAVE }));

    await reread.asked;
    expect(
      policyRow().queryByText("Rhian Pryce", { selector: "dd" }),
      "the refused owner was still shown before the list reloaded",
    ).toBeNull();
    reread.resolve();

    await waitFor(() => {
      expect(
        region()
          .queryAllByRole("alert")
          .some((each) => /\S/u.test(each.textContent)),
        "the refused naming raised no alert",
      ).toBe(true);
    });
    expect(policyRow().queryByText("Rhian Pryce", { selector: "dd" })).toBeNull();
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: PICKER })).toHaveProperty("value", ""),
    );
  });

  it("shows a Viewer who owns a collection no picker", async () => {
    const api = adaAnAdmin();
    api.set("session.member", () =>
      read({
        workspace: NORTHERN,
        person: { id: ADA.personId, name: ADA.displayName, email: ADA.address },
        role: "Viewer",
        owns: { collections: ["policy"], concepts: 0 },
      }),
    );
    api.set("knowledge.collections", () =>
      read({
        collections: [{ ...POLICY, owner: { id: ADA.personId, name: "Rhian Pryce" } }],
      }),
    );
    await openAt(PAGE, api);

    await screen.findByRole("heading", { level: 3, name: "policy" });
    expect(await policyRow().findByText("Rhian Pryce", { selector: "dd" })).toBeDefined();
    expect(region().queryAllByRole("combobox")).toHaveLength(0);
    expect(region().queryAllByRole("button")).toHaveLength(0);
  });
});
