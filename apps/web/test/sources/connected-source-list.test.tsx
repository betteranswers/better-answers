import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { NEEDS_OCR } from "@/features/sources/words.ts";
import { placedWithoutMeasuring } from "@test/measuring.ts";
import {
  aConnectedSource,
  anAdminWith,
  anId,
  connectedSourcesRegion,
  detailOf,
  moreDetailsOf,
  openSources,
  press,
  rowOf,
} from "@test/sources/stubbed-sources.ts";
import { server } from "@test/stub-server.ts";
import { adaAnAdmin, adaAt, read } from "@test/two-workspaces.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

placedWithoutMeasuring();

const EVERYONE = "Everyone in the workspace";

const termsOf = (row: HTMLElement) =>
  within(row)
    .getAllByRole("term")
    .map((term) => [term.textContent, term.nextElementSibling?.textContent]);

describe("the Sources page's list of connected sources", () => {
  it("reads an Admin a row's stored values as words", async () => {
    await openSources(anAdminWith(aConnectedSource("Staff handbook")));

    const handbook = await rowOf("Staff handbook");

    expect(within(handbook).getByRole("heading", { level: 3 }).textContent).toBe("Staff handbook");
    expect(
      within(handbook)
        .getAllByRole("button")
        .map((button) => [button.textContent, button.getAttribute("aria-expanded")]),
    ).toEqual([
      ["Review Findings Staff handbook", "false"],
      ["Publish Staff handbook", null],
      ["Narrow Sensitivity Staff handbook", "false"],
      ["Widen Sensitivity or Audience Staff handbook", "false"],
      ["More Details Staff handbook", "false"],
    ]);
    expect(termsOf(handbook)).toEqual([
      ["Connector", "Upload"],
      ["Sensitivity", "Internal"],
      ["Audience", EVERYONE],
      ["State", "Indexed"],
      ["Last Synced", expect.stringMatching(/^\d{2}:\d{2} · \d{1,2} \w+ \d{4}/v)],
    ]);
    const list = within(connectedSourcesRegion()).getByRole("list");
    for (const stored of ["received", "indexing", "indexed", "published", "upload"]) {
      expect(list.textContent, `the list shows the stored value ${stored}`).not.toContain(stored);
    }
  });

  it("tells an Admin more about a source in sentences", async () => {
    await openSources(anAdminWith(aConnectedSource("Staff handbook")));
    const handbook = await rowOf("Staff handbook");
    const destinations = (): string[] =>
      within(handbook)
        .queryAllByRole("term")
        .map((term) => term.textContent)
        .filter((word) => word.startsWith("Destination"));
    expect(destinations()).toEqual([]);

    fireEvent.click(moreDetailsOf(handbook));

    const aSentence = /\S\s+\S/v;
    expect(detailOf(handbook, "State").textContent).toMatch(aSentence);
    expect(destinations()).toEqual(["Destinations"]);
    const eachDestination = within(detailOf(handbook, "Destinations")).getAllByRole("paragraph");
    expect(eachDestination.map((destination) => destination.textContent)).toEqual([
      expect.stringMatching(aSentence),
      expect.stringMatching(aSentence),
    ]);
    expect(detailOf(handbook, "Retention").textContent).toMatch(aSentence);
  });

  it("tells an Admin why documents are unreadable, scans counted apart", async () => {
    const unreadable = (title: string, reason: string) => ({
      documentId: anId(),
      title,
      reason,
    });
    await openSources(
      anAdminWith(
        aConnectedSource("Board minutes", {
          documentCount: 1,
          unreadable: [unreadable("Minutes 2019", "DeadlineExceededError")],
          unreadableByReason: { DeadlineExceededError: 1 },
        }),
        aConnectedSource("Site archive", {
          documentCount: 5,
          unreadable: [
            unreadable("Archive", "DeadlineExceededError"),
            unreadable("Floor plan", NEEDS_OCR),
            unreadable("Old minutes", "UnicodeDecodeError"),
            unreadable("Site survey", NEEDS_OCR),
          ],
          unreadableByReason: { [NEEDS_OCR]: 2, DeadlineExceededError: 1, UnicodeDecodeError: 1 },
        }),
      ),
    );
    const archive = await rowOf("Site archive");

    fireEvent.click(moreDetailsOf(archive));

    const reasons = detailOf(archive, "Unreadable");
    expect(within(reasons).getByRole("paragraph").textContent).toMatch(/^\D*\b4\b\D+\b2\b\D*$/v);
    const titles = ["Archive", "Floor plan", "Old minutes", "Site survey"];
    const lines = within(reasons)
      .getAllByRole("listitem")
      .map((line) => line.textContent);
    expect(lines).toHaveLength(titles.length);
    for (const [at, title] of titles.entries()) {
      expect(lines[at]).toMatch(new RegExp(`^${title}\\W+\\w`, "v"));
    }
    const [timedOut, aScan, undecoded, anotherScan] = titles.map((title, at) =>
      lines[at]?.replace(title, ""),
    );
    expect(aScan, "two scans are given different reasons").toBe(anotherScan);
    expect(
      new Set([timedOut, aScan, undecoded]).size,
      "two different faults are given one reason",
    ).toBe(3);
    for (const stored of [NEEDS_OCR, "DeadlineExceededError", "UnicodeDecodeError"]) {
      expect(reasons.textContent, `a reason is shown as the stored ${stored}`).not.toContain(
        stored,
      );
    }
    const minutes = await rowOf("Board minutes");
    fireEvent.click(moreDetailsOf(minutes));
    expect(
      within(detailOf(minutes, "Unreadable")).getByRole("paragraph").textContent,
      "scans are counted where no document is one",
    ).toMatch(/^\D*\b1\b\D*$/v);
  });

  it("shows an Editor Connected Sources as not found, connecting nothing", async () => {
    const api = adaAnAdmin();
    api.set("session.member", () => adaAt("Editor"));
    api.set("sources.list", () => read([aConnectedSource("Staff handbook")]));

    await openSources(api);

    expect(await screen.findByRole("heading", { level: 1, name: "Page Not Found" })).toBeDefined();
    expect(screen.getByRole("link", { name: "Go to New Question" })).toBeDefined();
    expect(screen.queryByRole("region", { name: "Connected Sources" })).toBeNull();
    expect(document.body.textContent).not.toContain("Staff handbook");
    press("b");
    expect(screen.queryByRole("dialog", { name: "Connect a Document" })).toBeNull();
    expect(server.asks.filter((ask) => ask.procedure.startsWith("sources."))).toEqual([]);
  });
});
