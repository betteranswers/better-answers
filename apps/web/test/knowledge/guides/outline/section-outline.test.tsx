import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { headingIdOf } from "@/features/knowledge/guides/guide-state.ts";
import { GUIDE_WORDS } from "@/features/knowledge/guides/guide-words.ts";
import {
  A_GUIDE_PAGE,
  aFact,
  aGuide,
  aGuideApi,
  aSection,
  idOf,
} from "@test/knowledge/guide-answers.ts";
import { placedWithoutMeasuring } from "@test/measuring.ts";
import { openAt } from "@test/two-workspaces.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

placedWithoutMeasuring();

afterEach(() => {
  vi.restoreAllMocks();
});

const FIRST = idOf(21);

const SECOND = idOf(22);

const THIRD = idOf(23);

const FOURTH = idOf(24);

const guide = aGuide({
  sections: [
    aSection({
      sectionId: FIRST,
      number: "1",
      prompt: "Racking",
      coverage: { met: 4, of: 4, facts: [] },
      trustWords: "Verified automatically",
    }),
    aSection({
      sectionId: SECOND,
      number: "2",
      prompt: "Insurance",
      coverage: { met: 3, of: 4, facts: [aFact()] },
      trustWords: "Unverified",
    }),
    aSection({
      sectionId: THIRD,
      number: "2.1",
      prompt: "Cover",
      coverage: { met: 1, of: 1, facts: [] },
      trustWords: "Verified by Dana Example",
    }),
    aSection({
      sectionId: FOURTH,
      number: "3",
      prompt: "Notes",
      coverage: { met: 0, of: 0, facts: [] },
      trustWords: "Draft",
    }),
  ],
});

const outline = () => within(screen.getByRole("navigation", { name: GUIDE_WORDS.outline }));

const openOutline = async () => {
  await openAt(A_GUIDE_PAGE, aGuideApi("Viewer", guide));
  await screen.findByRole("heading", { level: 1, name: "Northgate Ltd" });
};

const placedAt = (tops: Readonly<Record<string, number>>) =>
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    return new DOMRect(0, tops[this.id] ?? 0, 0, 0);
  });

const aFrameLater = () => {
  vi.stubGlobal("requestAnimationFrame", (draw: FrameRequestCallback) =>
    window.setTimeout(() => {
      draw(0);
    }, 0),
  );
  vi.stubGlobal("cancelAnimationFrame", (frame: number) => {
    window.clearTimeout(frame);
  });
};

const current = () =>
  outline()
    .getAllByRole("link")
    .filter((link) => link.getAttribute("aria-current") === "location")
    .map((link) => link.textContent);

describe("the section outline", () => {
  it("lists each section with its coverage and trust words", async () => {
    await openOutline();

    expect(
      outline()
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual([
      `${GUIDE_WORDS.heading("1", "Racking")}${GUIDE_WORDS.total(4, 4)}Verified automatically`,
      `${GUIDE_WORDS.heading("2", "Insurance")}${GUIDE_WORDS.total(3, 4)}Unverified`,
      `${GUIDE_WORDS.heading("2.1", "Cover")}${GUIDE_WORDS.total(1, 1)}Verified by Dana Example`,
      `${GUIDE_WORDS.heading("3", "Notes")}Draft`,
    ]);
  });

  it("counts a single fact in the singular", async () => {
    await openOutline();

    const text = outline().getByRole("link", { name: /2\.1\. Cover/u }).textContent;
    expect(text).toMatch(/1 of 1 fact included/u);
    expect(text).not.toMatch(/facts/u);
  });

  it("draws no coverage for a section that expects no fact", async () => {
    await openOutline();

    expect(outline().getByRole("link", { name: /3\. Notes/u }).textContent).not.toMatch(/\bof\b/u);
  });

  it("marks the section being read as the page scrolls", async () => {
    aFrameLater();
    const tops = {
      [headingIdOf(FIRST)]: -900,
      [headingIdOf(SECOND)]: 60,
      [headingIdOf(THIRD)]: 700,
      [headingIdOf(FOURTH)]: 1400,
    };
    placedAt(tops);
    await openOutline();

    await waitFor(() => {
      expect(current()).toEqual([
        `${GUIDE_WORDS.heading("2", "Insurance")}${GUIDE_WORDS.total(3, 4)}Unverified`,
      ]);
    });

    tops[headingIdOf(SECOND)] = -400;
    tops[headingIdOf(THIRD)] = 60;
    tops[headingIdOf(FOURTH)] = 800;
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });

    await waitFor(() => {
      expect(current()).toHaveLength(1);
      expect(current()[0]).toContain(GUIDE_WORDS.heading("2.1", "Cover"));
    });
  });

  it("scrolls to a section and focuses its heading when chosen", async () => {
    const scrolled = vi.fn<() => void>();
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      value: scrolled,
      configurable: true,
    });
    await openOutline();

    fireEvent.click(outline().getByRole("link", { name: /2\. Insurance/u }));

    const heading = screen.getByRole("heading", { name: GUIDE_WORDS.heading("2", "Insurance") });
    expect(scrolled.mock.contexts).toEqual([heading]);
    expect(document.activeElement).toBe(heading);
    expect(window.location.hash, "the page changed its address").toBe("");
    Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  });

  it("folds behind a Sections button on a narrow page", async () => {
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      value: vi.fn<() => void>(),
      configurable: true,
    });
    await openOutline();
    const toggle = outline().getByRole("button", { name: GUIDE_WORDS.outline });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(outline().getByRole("link", { name: /1\. Racking/u }));
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  });
});
