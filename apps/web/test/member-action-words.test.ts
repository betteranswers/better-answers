import { describe, expect, it } from "vitest";

import { ACTIVITY_WORDS, MEMBER_PAGE_WORDS } from "@/features/people/member-action-words.ts";

const AMARA = "Amara Okafor";

describe("the Role card's words", () => {
  it("names the role picked, and tells the reader's own apart", () => {
    const theirs = MEMBER_PAGE_WORDS.changesTheirRole("Viewer");
    const yours = MEMBER_PAGE_WORDS.changesYourRole("Viewer");

    for (const said of [theirs, yours]) expect(said).toMatch(/\bViewer\b/);
    expect(yours).not.toBe(theirs);
  });

  it("names the role held, at rest and beside another pick", () => {
    const atRest = MEMBER_PAGE_WORDS.holdsRole(AMARA, "Editor");
    const besideAPick = MEMBER_PAGE_WORDS.heldUntilChanged(AMARA, "Editor");

    for (const said of [atRest, besideAPick]) {
      expect(said).toContain(AMARA);
      expect(said).toMatch(/\ban Editor\b/);
    }
    expect(atRest).not.toBe(besideAPick);
    expect(MEMBER_PAGE_WORDS.heldUntilChanged(AMARA, "Admin")).toMatch(/\ban Admin\b/);
  });
});

describe("the sign-ins part's words", () => {
  it("names the member whose sign-ins ended", () => {
    expect(MEMBER_PAGE_WORDS.everySignInEnded(AMARA)).toContain(AMARA);
  });
});

describe("an activity line's marker", () => {
  it("tells apart the member acting, acted on, and both", () => {
    const markers = [
      ACTIVITY_WORDS.direction.by(AMARA),
      ACTIVITY_WORDS.direction.to(AMARA),
      ACTIVITY_WORDS.direction.both(AMARA),
    ];

    for (const marker of markers) expect(marker).toContain(AMARA);
    expect(new Set(markers).size).toBe(3);
  });
});
