import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { INVITATIONS_FIELDS, INVITATIONS_LIST } from "@/features/people/invitations-address.ts";
import { useListAddress } from "@/shared/list-address.ts";

import { openPages } from "./address-router.tsx";

afterEach(cleanup);

function StatusShown() {
  const { state } = useListAddress(INVITATIONS_LIST, INVITATIONS_FIELDS);
  return <output>{state.status}</output>;
}

const statusAt = async (query: string) => {
  await openPages({ "/people": StatusShown }, [`/people${query}`]);
  return screen.getByRole("status").textContent;
};

describe("the Invitations tab's address", () => {
  it("reads a status it was given", async () => {
    expect(await statusAt("?invitations.status=expired")).toBe("expired");
  });

  it("reads a hand-edited unknown status as Waiting", async () => {
    expect(await statusAt("?invitations.status=bogus")).toBe("waiting");
  });
});
