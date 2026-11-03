import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SAID_OF_COLLECTIONS } from "@/features/knowledge/knowledge-words.ts";
import { KNOWLEDGE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";
import { placedWithoutMeasuring } from "@test/measuring.ts";
import { heldBack } from "@test/stubbed-api.ts";
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

const PICKER = /^New Owner\s?of policy$/;

const SAVE = /^Save\s?the new owner of policy$/;

const POLICY = { collection: "policy", owner: null, overrides: 0 };

const region = () => within(screen.getByRole("region", { name: "Collections and Owners" }));

const policyRow = () =>
  within(
    region().getByRole("heading", { level: 3, name: "policy" }).closest("li") ?? document.body,
  );

describe("the Collections and Owners page", () => {
  it("rolls back a naming the api refuses, saying why", async () => {
    const api = adaAnAdmin();
    api.set("members.list", () => read([ADA, RHIAN]));
    api.set("knowledge.collections", () => read({ collections: [POLICY] }));
    api.set("knowledge.nameOwner", () => {
      api.set("members.list", () => read([ADA]));
      return aRefusalAnswer("no-such-member", "precondition", 412);
    });
    await openAt(PAGE, api);

    const picker = await screen.findByRole("combobox", { name: PICKER });
    const reread = heldBack(api, "knowledge.collections");
    fireEvent.change(picker, { target: { value: RHIAN.personId } });
    fireEvent.click(screen.getByRole("button", { name: SAVE }));

    await reread.asked;
    expect(
      policyRow().queryByText("Rhian Pryce", { selector: "dd" }),
      "the refused owner stayed drawn before the list was read again",
    ).toBeNull();
    reread.resolve();

    const alert = await waitFor(() => {
      const found = region()
        .queryAllByRole("alert")
        .find((each) => each.textContent !== "");
      expect(found).toBeDefined();
      return found;
    });
    expect(alert?.textContent).toBe(SAID_OF_COLLECTIONS["no-such-member"]);
    expect(policyRow().queryByText("Rhian Pryce", { selector: "dd" })).toBeNull();
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: PICKER })).toHaveProperty("value", ""),
    );
  });

  it("a Viewer named owner reads their collection with no picker", async () => {
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
