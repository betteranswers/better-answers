import type { Page } from "@playwright/test";

import { UNKNOWN_PAGE } from "@/app/words.ts";

import { expect, test } from "./browser.ts";

const addImageWithoutAltText = (): void => {
  const picture = document.createElement("img");
  picture.src =
    "data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==";
  picture.width = 64;
  picture.height = 64;
  document.querySelector("main")?.append(picture);
};

const addButtonFadingToFullOpacity = (): void => {
  const button = document.createElement("button");
  button.textContent = "Change Role";
  button.style.cssText =
    "background: var(--primary); color: var(--primary-foreground); padding: 8px 16px; opacity: 0.5; transition: opacity 4s step-end";
  document.querySelector("main")?.append(button);
  // Force a style calculation at half opacity, so the change below runs as a transition.
  button.getBoundingClientRect();
  button.style.opacity = "1";
};

const addEndlessSpinner = (): void => {
  const spinner = document.createElement("span");
  spinner.style.cssText =
    "display: inline-block; width: 16px; height: 16px; border: 2px solid currentColor; animation: ba-spin 1s linear infinite";
  document.querySelector("main")?.append(spinner);
};

const addFourMarkedRegions = (): void => {
  for (const name of ["Coverage", "Sources", "Members", "Spend"]) {
    const region = document.createElement("section");
    region.dataset["marks"] = "";
    region.style.cssText = "height: 48px; margin: 16px; border: 1px solid var(--border)";
    region.textContent = name;
    document.querySelector("main")?.append(region);
  }
};

const addFaintTextInMarkedRegion = (): void => {
  const region = document.createElement("section");
  region.dataset["marks"] = "";
  region.style.cssText = "margin: 16px; border: 1px solid var(--border)";
  const faint = document.createElement("p");
  faint.style.color = "var(--border)";
  faint.textContent = "Nobody can read this sentence.";
  region.append(faint);
  document.querySelector("main")?.append(region);
};

const addTextOverBackgroundImage = (): void => {
  const words = document.createElement("p");
  words.style.backgroundImage =
    "url(data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==)";
  words.textContent = "Nobody can tell how this sentence reads.";
  document.querySelector("main")?.append(words);
};

/** Readable in light mode. Dark mode uses the border colour, because axe skips text that matches its background. */
const addTextUnreadableInDarkMode = (): void => {
  const style = document.createElement("style");
  style.textContent =
    '[data-theme="dark"] [data-dark-unreadable] { color: var(--border-default); }';
  document.head.append(style);
  const words = document.createElement("p");
  words.dataset["darkUnreadable"] = "";
  words.textContent = "Nobody can read this sentence in the dark.";
  document.querySelector("main")?.append(words);
};

const addBorderlessField = (): void => {
  const field = document.createElement("input");
  field.setAttribute("aria-label", "A field nobody can find");
  field.style.cssText = "border: 1px solid var(--surface-page); background: transparent";
  document.querySelector("main")?.append(field);
};

const addBorderlessFieldOnTint = (): void => {
  const tint = document.createElement("div");
  tint.style.cssText =
    "padding: 8px; background: color-mix(in oklab, var(--muted) 50%, transparent)";
  const field = document.createElement("input");
  field.setAttribute("aria-label", "A field nobody can find on a tint");
  field.style.cssText = "border: 1px solid var(--grey-0); background: transparent";
  tint.append(field);
  document.querySelector("main")?.append(tint);
};

const addBorderlessFieldsInBorderedBox = (): void => {
  const box = document.createElement("div");
  box.style.cssText = "padding: 8px; border: 1px solid var(--text-primary)";
  for (const which of ["first", "second"]) {
    const field = document.createElement("input");
    field.setAttribute("aria-label", `The ${which} field nobody can find in a box`);
    field.style.cssText =
      "display: block; height: 32px; margin-bottom: 8px; border: 1px solid var(--surface-page); background: transparent";
    box.append(field);
  }
  document.querySelector("main")?.append(box);
};

const addBorderlessFieldInFilledBox = (padding: string): void => {
  const box = document.createElement("div");
  box.style.cssText = `padding: ${padding}; background: var(--text-primary)`;
  const field = document.createElement("input");
  field.setAttribute("aria-label", "A field in a filled box");
  field.style.cssText =
    "display: block; height: 32px; border: 1px solid transparent; background: transparent; color: var(--surface-page)";
  box.append(field);
  document.querySelector("main")?.append(box);
};

const addFieldAboveRowBorder = (): void => {
  const row = document.createElement("div");
  row.style.cssText = "padding: 4px 24px; border-bottom: 1px solid var(--text-primary)";
  const field = document.createElement("input");
  field.setAttribute("aria-label", "A field found by its row's rule");
  field.style.cssText =
    "display: block; height: 32px; border: 1px solid var(--surface-page); background: transparent";
  row.append(field);
  document.querySelector("main")?.append(row);
};

/** axe already fails a dimmed field on text contrast, so only a control without text tests the edge check alone. */
const addTextlessCheckbox = (dimmedTo: number): void => {
  const box = document.createElement("div");
  box.style.opacity = String(dimmedTo);
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.setAttribute("aria-label", "A checkbox dimmed with its box");
  checkbox.style.cssText =
    "appearance: none; display: block; width: 24px; height: 24px; margin: 0; border: 1px solid var(--border-control); background: transparent";
  box.append(checkbox);
  document.querySelector("main")?.append(box);
};

const scrollButtonHalfUnderStickyHeader = (): boolean => {
  const header = document.createElement("header");
  header.style.cssText =
    "position: sticky; top: 0; z-index: 30; box-sizing: border-box; height: 48px; padding: 8px 0;";
  const headerButton = document.createElement("button");
  headerButton.textContent = "Jump To";
  headerButton.style.cssText = "display: block; width: 176px; height: 32px;";
  header.append(headerButton);
  document.body.prepend(header);

  const coveredButton = document.createElement("button");
  coveredButton.textContent = "Details";
  coveredButton.style.cssText = "display: block; width: 70px; height: 24px;";
  const spacer = document.createElement("div");
  spacer.style.height = "200vh";
  document.body.append(coveredButton, spacer);

  window.scrollBy(0, coveredButton.getBoundingClientRect().top - 26);
  const headerButtonBox = headerButton.getBoundingClientRect();
  const coveredBox = coveredButton.getBoundingClientRect();
  return (
    coveredBox.top < headerButtonBox.bottom &&
    coveredBox.bottom > header.getBoundingClientRect().bottom
  );
};

const openSignInPage = async (page: Page): Promise<void> => {
  await page.goto("/sign-in");
  await expect(page.getByRole("heading", { level: 1, name: UNKNOWN_PAGE.signIn })).toBeVisible();
};

test("audits a test's last page even without an explicit call", async ({ page }) => {
  test.fail();
  await openSignInPage(page);
  await page.evaluate(addImageWithoutAltText);
});

test("fails a test that leaves the origin without an audit", async ({ page }) => {
  test.fail();
  await openSignInPage(page);

  await page.goto("about:blank");
});

test("passes a test that audits before it leaves the origin", async ({
  page,
  passesTheAccessibilityGate,
}) => {
  await openSignInPage(page);
  await passesTheAccessibilityGate();
  await page.goto("about:blank");
});

test("passes a test that ends on an accessible page", async ({ page }) => {
  await openSignInPage(page);
});

test("waits for a button's opacity transition to end before auditing", async ({
  page,
  passesTheAccessibilityGate,
}) => {
  await openSignInPage(page);
  await page.evaluate(addButtonFadingToFullOpacity);
  await passesTheAccessibilityGate();
});

test("passes a button half hidden under a sticky header", async ({ page }) => {
  await openSignInPage(page);
  expect(
    await page.evaluate(scrollButtonHalfUnderStickyHeader),
    "the setup did not place a button half under the sticky header",
  ).toBe(true);
});

test("audits a page with a spinner that never stops", async ({ page }) => {
  await openSignInPage(page);
  await page.evaluate(addEndlessSpinner);
});

test("fails a page with more than three decorative marks", async ({ page }) => {
  test.fail();
  await openSignInPage(page);
  await page.evaluate(addFourMarkedRegions);
});

test("checks the contrast of text inside a marked region", async ({ page }) => {
  test.fail();
  await openSignInPage(page);
  await page.evaluate(addFaintTextInMarkedRegion);
});

test("fails text over an image when axe cannot decide contrast", async ({ page }) => {
  test.fail();
  await openSignInPage(page);
  await page.evaluate(addTextOverBackgroundImage);
});

test("fails text that is unreadable only in dark mode", async ({ page }) => {
  test.fail();
  await openSignInPage(page);
  await page.evaluate(addTextUnreadableInDarkMode);
});

test("fails a field with no visible border", async ({ page }) => {
  test.fail();
  await openSignInPage(page);
  await page.evaluate(addBorderlessField);
});

test("fails a borderless field on a semi-transparent tint", async ({ page }) => {
  test.fail();
  await openSignInPage(page);
  await page.evaluate(addBorderlessFieldOnTint);
});

test("fails fields whose only edge is a layout box's border", async ({ page }) => {
  test.fail();
  await openSignInPage(page);
  await page.evaluate(addBorderlessFieldsInBorderedBox);
});

test("fails a field set 9px inside a filled box", async ({ page }) => {
  test.fail();
  await openSignInPage(page);
  await page.evaluate(addBorderlessFieldInFilledBox, "9px");
});

test("passes a field within 5px of a filled box's edge", async ({ page }) => {
  await openSignInPage(page);
  await page.evaluate(addBorderlessFieldInFilledBox, "5px 9px 9px");
});

test("passes a field whose row has a bottom border", async ({ page }) => {
  await openSignInPage(page);
  await page.evaluate(addFieldAboveRowBorder);
});

test("passes a checkbox with no visible label at full opacity", async ({ page }) => {
  await openSignInPage(page);
  await page.evaluate(addTextlessCheckbox, 1);
});

test("fails a checkbox dimmed to 30% opacity with its box", async ({ page }) => {
  test.fail();
  await openSignInPage(page);
  await page.evaluate(addTextlessCheckbox, 0.3);
});
