import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConnectedSourceWidened } from "@/features/sources/sources-api.ts";
import { placedWithoutMeasuring } from "@test/measuring.ts";
import {
  aConnectedSource,
  anAdminWith,
  anId,
  describedBy,
  leadOf,
  openSources,
  panelOf,
  press,
  pressed,
  rowAction,
  rowOf,
  saidIn,
  thePanelOf,
  connectedSourcesRegion,
} from "@test/sources/stubbed-sources.ts";
import { heldBack } from "@test/stubbed-api.ts";
import { aRefusalAnswer, read } from "@test/two-workspaces.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

placedWithoutMeasuring();

// jsdom lays nothing out, and a select scrolls its chosen choice into view as it opens.
beforeEach(() => {
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    value: () => undefined,
    configurable: true,
  });
});

afterEach(() => {
  Reflect.deleteProperty(Element.prototype, "scrollIntoView");
});

const EVERYONE = "Everyone in the workspace";

const NAMED_GROUPS = "Named groups";

const A_PUBLICATION = "2026-10-07T09:05:00.000Z";

const textsOf = (elements: readonly HTMLElement[]): (string | null)[] =>
  elements.map((each) => each.textContent);

const commitIn = (panel: HTMLElement, label: "Narrow" | "Widen") =>
  within(panel).getByRole("button", { name: label });

const widenedTo = (
  sensitivity: ConnectedSourceWidened["visibility"]["sensitivity"],
  audience: ConnectedSourceWidened["visibility"]["audience"],
  moved: { readonly concepts?: readonly string[]; readonly writeUps?: readonly string[] } = {},
) => ({ visibility: { sensitivity, audience }, concepts: [], writeUps: [], ...moved });

const aWideningOpened = async () => {
  await openSources(anAdminWith(aConnectedSource("Staff handbook", { sensitivity: "Restricted" })));
  const row = await rowOf("Staff handbook");
  const opener = rowAction(row, "widen");
  pressed(opener);
  const panel = thePanelOf("widen", "Staff handbook");
  const sensitivityPicked = within(panel).getByRole("combobox", { name: "Sensitivity" });
  expect(document.activeElement).toBe(sensitivityPicked);
  return { row, opener, panel, sensitivityPicked };
};

describe("publishing, narrowing and widening a connected source", () => {
  it("narrows a published source inline, its citing concepts moving too", async () => {
    const citing = "https://better-answers.test/concepts/payment-terms";
    const published = aConnectedSource("Supplier payments", {
      state: "published",
      publishedAt: A_PUBLICATION,
    });
    const narrowed = {
      ...widenedTo("Restricted", "everyone", { concepts: [citing], writeUps: [anId()] }),
      connectedSourceId: published.connectedSourceId,
      auditEventId: anId(),
    };
    const api = anAdminWith(published);
    api.set("sources.narrow", () => {
      api.set("sources.list", () => read([{ ...published, sensitivity: "Restricted" }]));
      return read(narrowed);
    });
    await openSources(api);
    const row = await rowOf("Supplier payments");
    rowAction(row, "narrow").focus();

    press("n");

    const panel = thePanelOf("narrow", "Supplier payments");
    expect(describedBy(panel)).toMatch(/\S/v);
    const sensitivityPicked = within(panel).getByRole("combobox", { name: "Sensitivity" });
    expect(document.activeElement).toBe(sensitivityPicked);
    expect(sensitivityPicked.textContent).toBe("Restricted");
    expect(within(panel).getAllByRole("combobox")).toHaveLength(1);
    expect(textsOf(within(panel).getAllByRole("term"))).toEqual(["Sensitivity"]);
    expect(textsOf(within(panel).getAllByRole("definition"))).toEqual([
      expect.stringMatching(/Internal.+Restricted/v),
    ]);
    expect(screen.queryByRole("dialog")).toBeNull();
    const commit = commitIn(panel, "Narrow");
    commit.focus();
    fireEvent.click(commit);

    expect(panelOf("narrow", "Supplier payments")).toBeNull();
    expect(document.activeElement).toBe(
      within(row).getByRole("heading", { level: 3, name: "Supplier payments" }),
    );
    await waitFor(() => {
      expect(leadOf(row, "Sensitivity").textContent).toBe("Restricted");
    });
    await waitFor(() => {
      expect(saidIn()?.textContent).toMatch(/Supplier payments\D+Restricted\D+\b1\b\D+\b1\b/v);
    });
    expect(screen.getByText(citing)).toBeDefined();
  });

  it("lists the audience among the changes once it widens too", async () => {
    const handbook = aConnectedSource("Staff handbook", {
      sensitivity: "Restricted",
      audience: "groups",
      audienceGroups: [anId()],
    });
    const api = anAdminWith(handbook);
    api.set("sources.widen", () => {
      api.set("sources.list", () =>
        read([
          { ...handbook, sensitivity: "Internal", audience: "everyone", audienceGroups: null },
        ]),
      );
      return read(widenedTo("Internal", "everyone"));
    });
    await openSources(api);
    const row = await rowOf("Staff handbook");

    pressed(rowAction(row, "widen"));

    const panel = thePanelOf("widen", "Staff handbook");
    expect(describedBy(panel)).toMatch(/\S/v);
    const sensitivityPicked = within(panel).getByRole("combobox", { name: "Sensitivity" });
    expect(document.activeElement).toBe(sensitivityPicked);
    expect(sensitivityPicked.textContent).toBe("Internal");
    expect(textsOf(within(panel).getAllByRole("term"))).toEqual(["Sensitivity"]);
    expect(textsOf(within(panel).getAllByRole("definition"))).toEqual([
      expect.stringMatching(/Restricted.+Internal/v),
    ]);
    expect(commitIn(panel, "Widen")).toBeDefined();

    fireEvent.keyDown(within(panel).getByRole("combobox", { name: "Audience" }), { key: "Enter" });
    fireEvent.keyDown(await screen.findByRole("option", { name: EVERYONE }), { key: "Enter" });

    expect(textsOf(within(panel).getAllByRole("term"))).toEqual(["Sensitivity", "Audience"]);
    expect(textsOf(within(panel).getAllByRole("definition"))).toEqual([
      expect.stringMatching(/Restricted.+Internal/v),
      expect.stringMatching(new RegExp(`${NAMED_GROUPS}.+${EVERYONE}`, "iv")),
    ]);
    fireEvent.click(commitIn(panel, "Widen"));

    await waitFor(() => {
      expect(saidIn()?.textContent).toMatch(/Staff handbook\D+Internal/v);
    });
    await waitFor(() => {
      expect(leadOf(row, "Sensitivity").textContent).toBe("Internal");
    });
    expect(leadOf(row, "Audience").textContent).toBe(EVERYONE);
  });

  it("closes a widening on Escape, focus back on Widen", async () => {
    const { row, opener, panel } = await aWideningOpened();
    const commit = commitIn(panel, "Widen");
    commit.focus();

    fireEvent.keyDown(commit, { key: "Escape" });

    expect(panelOf("widen", "Staff handbook")).toBeNull();
    expect(document.activeElement, "Escape did not hand focus back to the button").toBe(opener);
    expect(leadOf(row, "Sensitivity").textContent).toBe("Restricted");
  });

  it("Escape closes an open select, not the panel", async () => {
    const { opener, sensitivityPicked } = await aWideningOpened();
    fireEvent.keyDown(sensitivityPicked, { key: "Enter" });
    expect(await screen.findByRole("option", { name: "Internal" })).toBeDefined();
    await waitFor(() => {
      expect(screen.getByRole("listbox").contains(document.activeElement)).toBe(true);
    });

    press("Escape");

    await waitFor(() => {
      expect(screen.queryByRole("listbox")).toBeNull();
    });
    expect(
      panelOf("widen", "Staff handbook"),
      "the Escape that closed the select closed the panel too",
    ).not.toBeNull();
    await waitFor(() => {
      expect(document.activeElement).toBe(sensitivityPicked);
    });
    press("Escape");
    expect(panelOf("widen", "Staff handbook")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("Narrow and Widen say whether their panel is open", async () => {
    await openSources(
      anAdminWith(aConnectedSource("Staff handbook"), aConnectedSource("Price list")),
    );
    const handbook = await rowOf("Staff handbook");
    const priceList = await rowOf("Price list");
    const narrow = rowAction(handbook, "narrow");
    const widen = rowAction(handbook, "widen");
    const otherWiden = rowAction(priceList, "widen");
    const expandedAre = (expected: { readonly narrow: string; readonly widen: string }) => {
      expect(narrow.getAttribute("aria-expanded")).toBe(expected.narrow);
      expect(widen.getAttribute("aria-expanded")).toBe(expected.widen);
      expect(otherWiden.getAttribute("aria-expanded")).toBe("false");
    };

    expandedAre({ narrow: "false", widen: "false" });
    pressed(widen);
    expect(panelOf("widen", "Staff handbook")).not.toBeNull();
    expandedAre({ narrow: "false", widen: "true" });

    pressed(narrow);
    expect(panelOf("narrow", "Staff handbook")).not.toBeNull();
    expandedAre({ narrow: "true", widen: "false" });

    fireEvent.click(
      within(thePanelOf("narrow", "Staff handbook")).getByRole("button", { name: "Cancel" }),
    );
    expandedAre({ narrow: "false", widen: "false" });
  });

  it("holds a second widening while the first is still pending", async () => {
    const api = anAdminWith(aConnectedSource("Bid library"), aConnectedSource("Case studies"));
    const widening = heldBack(api, "sources.widen", read(widenedTo("Public", "everyone")));
    await openSources(api);
    const bidLibrary = await rowOf("Bid library");
    const caseStudies = await rowOf("Case studies");

    pressed(rowAction(bidLibrary, "widen"));
    pressed(commitIn(thePanelOf("widen", "Bid library"), "Widen"));
    await widening.asked;
    await waitFor(() => {
      expect(leadOf(bidLibrary, "Sensitivity").textContent).toBe("Public");
    });

    pressed(rowAction(caseStudies, "widen"));
    const second = commitIn(thePanelOf("widen", "Case studies"), "Widen");
    expect(second.getAttribute("aria-disabled")).toBe("true");
    expect(describedBy(second)).toMatch(/\S/v);
    second.focus();
    fireEvent.click(second);
    expect(panelOf("widen", "Case studies")).not.toBeNull();
    expect(leadOf(caseStudies, "Sensitivity").textContent).toBe("Internal");
    widening.resolve();

    await waitFor(() => {
      expect(saidIn()?.textContent).toMatch(/Bid library\D+Public/v);
    });
    expect(second.getAttribute("aria-disabled")).toBe("false");
    expect(describedBy(second)).toBe("");
    expect(widening.asks, "the second press asked the api while the first was pending").toBe(1);
  });

  it("refuses widening with a special category finding unreviewed", async () => {
    const api = anAdminWith(
      aConnectedSource("Service records", {
        sensitivity: "Restricted",
        state: "published",
        publishedAt: A_PUBLICATION,
      }),
    );
    api.set("sources.widen", () =>
      aRefusalAnswer("special-category-unreviewed", "precondition", 409),
    );
    await openSources(api);
    const row = await rowOf("Service records");

    pressed(rowAction(row, "widen"));
    pressed(commitIn(thePanelOf("widen", "Service records"), "Widen"));

    await waitFor(() => {
      const refusals = within(connectedSourcesRegion())
        .getAllByRole("alert")
        .filter((alert) => alert.textContent !== "");
      expect(refusals, "the alert says nothing").toHaveLength(1);
    });
    await waitFor(() => {
      expect(leadOf(row, "Sensitivity").textContent).toBe("Restricted");
    });
  });
});
