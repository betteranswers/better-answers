import type { Locator, Page } from "@playwright/test";

import { CONTROL_CENTRE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";

import { expect, test } from "./browser.ts";
import { bundledHarness, harnessDrawn } from "./drawn-parts.ts";
import { anAddress, provision, signedInAtHome, tokenColour } from "./harness.ts";

const MEMBERS = pageNamed(menuGroupIn(CONTROL_CENTRE, "people"), "Members");

let parts: string | undefined;

test.beforeAll(async () => {
  parts = await bundledHarness({
    name: "blueprint-parts",
    file: new URL("../test/blueprint-parts.tsx", import.meta.url),
    component: "BlueprintParts",
  });
});

/** A mark is the part's `::before`; `none` means it draws no "+". */
const marksOf = (part: Locator) =>
  part.evaluate((element) => {
    const mark = getComputedStyle(element, "::before");
    return { content: mark.content, ink: mark.backgroundImage, top: mark.top, left: mark.left };
  });

const drawnBoard = async (page: Page, request: Parameters<typeof harnessDrawn>[1]) => {
  await harnessDrawn(page, request, { title: "Blueprint", script: parts ?? "" });
  await expect(page.getByRole("region", { name: "Board" })).toBeVisible();
};

test.describe("the blueprint's parts, drawn on one board", () => {
  test("draws a frame transparent, hairlined and marked", async ({ page, request }) => {
    await drawnBoard(page, request);
    const frame = page.getByRole("figure", { name: "Frame" });

    await expect(frame).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(frame).toHaveCSS("border-top-width", "1px");
    const marks = await marksOf(frame);
    expect(marks.content, "the frame draws no marks").not.toBe("none");
    expect(marks.ink, "the frame's marks are not the mark colour").toContain(
      await tokenColour(page, "--border-default"),
    );
    // Centred on the hairline: three pixels of arm either side of the one-pixel line.
    expect([marks.top, marks.left]).toEqual(["-4px", "-4px"]);
  });

  test("marks a card only when asked, never inside a frame", async ({ page, request }) => {
    await drawnBoard(page, request);

    expect((await marksOf(page.getByRole("region", { name: "Marked card" }))).content).not.toBe(
      "none",
    );
    expect((await marksOf(page.getByRole("region", { name: "Plain card" }))).content).toBe("none");
    expect((await marksOf(page.getByRole("region", { name: "Card in a frame" }))).content).toBe(
      "none",
    );
  });

  test("sinks a card's footer under a hairline", async ({ page, request }) => {
    await drawnBoard(page, request);
    const footer = page.getByRole("region", { name: "Marked card" }).getByText("From the map");

    await expect(footer).toHaveCSS("background-color", await tokenColour(page, "--surface-sunken"));
    await expect(footer).toHaveCSS("border-top-width", "1px");
  });

  test("lays the grid and the dots at their tokens' pitch", async ({ page, request }) => {
    await drawnBoard(page, request);
    const module = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--grid-module").trim(),
    );
    const gap = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--dot-gap").trim(),
    );

    const board = page.getByRole("region", { name: "Board" });
    // One gradient across, one down.
    await expect(board).toHaveCSS("background-size", `${module} ${module}, ${module} ${module}`);
    await expect(board).toHaveCSS("background-image", /linear-gradient/);

    const empty = page.getByRole("region", { name: "Empty" });
    await expect(empty).toHaveCSS("background-size", `${gap} ${gap}`);
    await expect(empty).toHaveCSS("background-image", /radial-gradient/);
  });

  test("leaves the accent fill and a small primary unmarked", async ({ page, request }) => {
    await drawnBoard(page, request);

    for (const name of ["Approve this row", "Small primary"]) {
      const button = page.getByRole("button", { name });
      await expect(button).not.toHaveAttribute("data-marks");
      expect((await marksOf(button)).content, `${name} draws marks`).toBe("none");
    }
    await expect(page.getByRole("button", { name: "Approve this row" })).toHaveCSS(
      "background-color",
      await tokenColour(page, "--accent-600"),
    );
  });
});

test("marks the primary button on a page in light accent", async ({ page, request }) => {
  const email = anAddress("marks");
  await provision(request, { name: "Holme Valley Joinery", adminEmail: email });
  await signedInAtHome(page, request, email);
  await page.goto(MEMBERS.path);
  const invite = page.getByRole("button", { name: "Invite a person" });
  await expect(invite).toBeVisible();

  const marks = await marksOf(invite);
  expect(marks.content, "the primary button draws no marks").not.toBe("none");
  expect(marks.ink, "the primary's marks are not the light accent").toContain(
    await tokenColour(page, "--accent-300"),
  );
});
