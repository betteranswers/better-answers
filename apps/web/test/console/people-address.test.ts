import { afterEach, describe, expect, it } from "vitest";

import { arrival, EVERYONE_PATH } from "@/features/console/people-address.ts";
import { addressOf } from "@/shared/address/address-ask.ts";

const PRIYA = { id: "p1", email: "priya@acme.invalid" };

const openAt = (address: string): void => {
  globalThis.history.replaceState(null, "", address);
};

afterEach(() => {
  openAt("/");
});

describe("the address a sheet's action reopens from", () => {
  it("reads the person and the action their address names", () => {
    openAt(addressOf(EVERYONE_PATH, { search: PRIYA.email, person: PRIYA.id, action: "correct" }));

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
