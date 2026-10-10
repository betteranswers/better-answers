import { describe, expect, it } from "vitest";

import { ACTIVITY_WORDS, MEMBER_PAGE_WORDS } from "@/features/people/member-action-words.ts";

describe("the Role card's words", () => {
  it("names the change with the role's own article", () => {
    expect(MEMBER_PAGE_WORDS.makeRole("Amara Okafor", "Viewer")).toBe("Make Amara Okafor a Viewer");
    expect(MEMBER_PAGE_WORDS.makeRole("Amara Okafor", "Editor")).toBe(
      "Make Amara Okafor an Editor",
    );
  });

  it("says the role held, at rest and beside another pick", () => {
    expect(MEMBER_PAGE_WORDS.holdsRole("Amara Okafor", "Editor")).toBe(
      "Amara Okafor is an Editor. Pick another role to change it.",
    );
    expect(MEMBER_PAGE_WORDS.heldUntilChanged("Amara Okafor", "Admin")).toBe(
      "Amara Okafor is an Admin now.",
    );
  });
});

describe("the sign-ins part's words", () => {
  it("keeps the glossary's name for the action", () => {
    expect(MEMBER_PAGE_WORDS.signInsAndTokens).toBe("Sign-ins and personal tokens");
    expect(MEMBER_PAGE_WORDS.endEverySignInAndToken).toBe("End every sign-in and token here");
    expect(MEMBER_PAGE_WORDS.everySignInEnded("Amara Okafor")).toBe(
      "Every sign-in and token Amara Okafor held here has ended.",
    );
  });
});

describe("an activity line's marker", () => {
  it("says whether the member acted or was acted on", () => {
    expect(ACTIVITY_WORDS.direction.by("Amara Okafor")).toBe("Done by Amara Okafor");
    expect(ACTIVITY_WORDS.direction.to("Amara Okafor")).toBe("Done to Amara Okafor");
    expect(ACTIVITY_WORDS.direction.both("Amara Okafor")).toBe("Done by and to Amara Okafor");
  });
});
