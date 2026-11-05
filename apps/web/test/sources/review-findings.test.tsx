import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { placedWithoutMeasuring } from "@test/measuring.ts";
import {
  aConnectedSource,
  aGroupOfFindings,
  anAdminWith,
  anId,
  BANK_ACCOUNT_BOX,
  describedBy,
  openSources,
  press,
  reviewOf,
  rowAction,
  rowOf,
  supplierFormsFindings,
} from "@test/sources/stubbed-sources.ts";
import { read } from "@test/two-workspaces.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

placedWithoutMeasuring();

const reviewHeading = (name: string) =>
  screen.getByRole("heading", { level: 4, name: `Review of ${name}` });

const findingRow = (row: HTMLElement, document: string, rule: string): HTMLElement => {
  const found = within(row)
    .getAllByRole("row")
    .filter((each) => [document, rule].every((word) => each.textContent.includes(word)));
  const [only] = found;
  if (found.length !== 1 || only === undefined)
    throw new Error(`expected one row for ${document} and ${rule}, found ${found.length}`);
  return only;
};

const openSupplierFormsReview = async () => {
  const findings = supplierFormsFindings();
  const api = anAdminWith(aConnectedSource("Supplier forms"));
  api.set("sources.findings", () => read(findings));
  await openSources(api);
  const row = await rowOf("Supplier forms");
  fireEvent.click(rowAction(row, "review"));
  const box = await within(row).findByRole("checkbox", { name: BANK_ACCOUNT_BOX });
  return { row, box };
};

describe("reviewing a connected source's findings", () => {
  it("never shows an unknown rule's id", async () => {
    const findings = [
      aGroupOfFindings({
        title: "Passport scan",
        category: "government-identifier",
        ruleId: "UK_PASSPORT",
        found: 1,
      }),
    ];
    const api = anAdminWith(aConnectedSource("Visa files"));
    api.set("sources.findings", () => read(findings));
    await openSources(api);
    const visaFiles = await rowOf("Visa files");

    fireEvent.click(rowAction(visaFiles, "review"));

    await within(visaFiles).findByRole("table");
    const finding = findingRow(visaFiles, "Passport scan", "Passport scan");
    expect(finding.textContent).not.toContain("UK_PASSPORT");
    expect(within(finding).getByRole("checkbox").getAttribute("aria-label")).not.toContain(
      "UK_PASSPORT",
    );
  });

  it("x selects nothing once focus leaves the table", async () => {
    const { row, box } = await openSupplierFormsReview();
    box.focus();
    reviewHeading("Supplier forms").focus();

    press("x");

    expect(box.getAttribute("aria-checked"), "x selected a group not in focus").toBe("false");
    const keep = within(row).getByRole<HTMLButtonElement>("button", { name: "Keep in Text" });
    expect(keep.disabled).toBe(true);
    expect(describedBy(keep), "the disabled Keep in Text has no hint").toMatch(/\S/v);
  });

  it("n narrows the source whose review has focus", async () => {
    const { row, box } = await openSupplierFormsReview();
    box.focus();

    press("n");

    expect(rowAction(row, "narrow").getAttribute("aria-expanded")).toBe("true");
  });

  it("closes one review when the Admin opens another", async () => {
    const findings = supplierFormsFindings();
    const api = anAdminWith(
      aConnectedSource("Supplier forms"),
      aConnectedSource("Service records"),
    );
    api.set("sources.findings", () => read(findings));
    await openSources(api);
    const supplier = await rowOf("Supplier forms");
    const records = await rowOf("Service records");
    fireEvent.click(rowAction(supplier, "review"));
    expect(reviewOf("Supplier forms")).not.toBeNull();

    fireEvent.click(rowAction(records, "review"));

    expect(reviewOf("Service records")).not.toBeNull();
    expect(document.activeElement).toBe(reviewHeading("Service records"));
    expect(reviewOf("Supplier forms")).toBeNull();
    expect(rowAction(supplier, "review").getAttribute("aria-expanded")).toBe("false");
  });

  it("tells the Admin how to enable the three actions", async () => {
    const { row } = await openSupplierFormsReview();
    const review = within(within(row).getByRole("region", { name: "Review of Supplier forms" }));
    const hint = describedBy(review.getByRole("button", { name: "Keep in Text" }));
    expect(hint, "Keep in Text has no hint saying how to enable it").toMatch(/\S/v);

    for (const name of [
      "Keep in Text",
      "Narrow These Documents",
      "Dismiss as Not Special Category",
    ]) {
      const action = review.getByRole<HTMLButtonElement>("button", {
        name,
        description: hint,
      });
      expect(action.disabled).toBe(true);
    }
    fireEvent.click(review.getByRole("checkbox", { name: BANK_ACCOUNT_BOX }));

    expect(
      review.queryByRole("button", { name: "Keep in Text", description: hint }),
      "Keep in Text kept its hint after a group was ticked",
    ).toBeNull();
    expect(
      review.getByRole<HTMLButtonElement>("button", { name: "Keep in Text", description: "" })
        .disabled,
    ).toBe(false);
  });

  it("notes kept findings that an erasure request still withholds", async () => {
    const findings = [
      aGroupOfFindings({ title: "March payroll", found: 2, overriddenByErasure: 2 }),
    ];
    const api = anAdminWith(aConnectedSource("Payroll exports"));
    api.set("sources.findings", () => read(findings));
    await openSources(api);
    const row = await rowOf("Payroll exports");

    fireEvent.click(rowAction(row, "review"));

    await within(row).findByRole("table");
    const notes = within(findingRow(row, "March payroll", "Sort code and account number"))
      .getAllByRole("paragraph")
      .map((note) => note.textContent);
    expect(
      notes,
      "the group does not have exactly one note counting two withheld findings",
    ).toEqual([expect.stringMatching(/\b2\b/v)]);
  });

  it("previews the passages of an unpublished source", async () => {
    const passages = ["The handbook says what the company decided.", "Pay goes to [withheld]."];
    const api = anAdminWith(aConnectedSource("Staff handbook"));
    api.set("sources.findings", () => read([]));
    api.set("sources.preview", () => read(passages.map((content) => ({ id: anId(), content }))));
    await openSources(api);
    const row = await rowOf("Staff handbook");
    fireEvent.click(rowAction(row, "review"));

    fireEvent.click(within(row).getByRole("button", { name: "Preview Passages" }));

    const shown = await within(row).findAllByRole("listitem");
    expect(shown.map((passage) => passage.textContent)).toEqual(passages);
  });
});
