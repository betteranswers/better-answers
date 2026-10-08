import { afterEach, describe, expect, it } from "vitest";

import { arrival, backTo, EVERYONE_PATH } from "@/features/console/people-address.ts";

const PRIYA = { id: "p1", email: "priya@acme.invalid" };

const openAt = (address: string): void => {
  globalThis.history.replaceState(null, "", address);
};

afterEach(() => {
  openAt("/");
});

describe("where signing in again comes back to", () => {
  it("reopens the person at the action their address names", () => {
    openAt(backTo(PRIYA, "correct"));

    expect(arrival()).toEqual({ search: PRIYA.email, personId: PRIYA.id, action: "correct" });
  });

  it("reopens an action an address names under its older key", () => {
    openAt(`${EVERYONE_PATH}?search=priya%40acme.invalid&person=p1&act=correct`);

    expect(arrival()).toEqual({ search: PRIYA.email, personId: PRIYA.id, action: "correct" });
  });

  it("reopens at ending every sign-in when no action is named", () => {
    openAt(`${EVERYONE_PATH}?person=p1`);

    expect(arrival()).toEqual({ search: "", personId: "p1", action: "revoke" });
  });
});
