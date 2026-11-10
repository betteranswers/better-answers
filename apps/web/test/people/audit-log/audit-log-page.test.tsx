import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { ReadAuditEvent } from "@/shared/audit/audit-event.ts";
import { CONTROL_CENTRE, menuGroupIn, pageById } from "@/shared/navigation.ts";
import { placedWithoutMeasuring } from "@test/measuring.ts";
import { holdProcedure } from "@test/stubbed-api.ts";
import { adaAnAdmin, openAt, read } from "@test/two-workspaces.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

placedWithoutMeasuring();

const AUDIT_LOG = "/system/audit-log";

const PRIYA_ADDRESS = "priya@example.test";

const BY_PRIYA = /Priya Shah.*Bid writers/;

const groupCreated = (
  id: string,
  by: { readonly displayName: string; readonly address: string },
  group: string,
): ReadAuditEvent => ({
  id: z.string().brand<"AuditEventId">().parse(id),
  action: "people.group.created",
  family: "people",
  subjectKind: "group",
  subjectId: `group-${id}`,
  actor: `human:${by.address}`,
  at: "2026-10-27T09:30:00.000Z",
  by: { kind: "person", ...by },
  subject: { kind: "group", name: group },
  detail: {},
  named: {},
});

const PRIYAS = groupCreated(
  "01JEVENT00000000000000002A",
  { displayName: "Priya Shah", address: PRIYA_ADDRESS },
  "Bid writers",
);

const EVERYONES = [
  groupCreated(
    "01JEVENT00000000000000003A",
    { displayName: "Sam Okoro", address: "sam@example.test" },
    "Estimators",
  ),
  PRIYAS,
  groupCreated(
    "01JEVENT00000000000000001A",
    { displayName: "Una Byrne", address: "una@example.test" },
    "Site leads",
  ),
];

const pageOf = (events: readonly ReadAuditEvent[]) =>
  read({ events, nextCursor: null, searchTooBroad: false });

const log = () =>
  within(
    screen.getByRole("region", {
      name: pageById(menuGroupIn(CONTROL_CENTRE, "system"), "audit-log").name,
    }),
  );

const lines = () => log().queryAllByRole("listitem");

const lineBy = (name: RegExp): HTMLElement => {
  const line = lines().find((each) => name.test(each.textContent));
  if (line === undefined) throw new Error("the audit log has no line for this person");
  return line;
};

/** jsdom joins "Details" to the visually hidden " of …" without the space a browser keeps. */
const detailsOf = (line: HTMLElement) =>
  within(line).getByRole("button", { name: /^Details ?of / });

describe("the System group's Audit log page", () => {
  it("keeps details open while a typed search finishes", async () => {
    const api = adaAnAdmin();
    api.set("members.auditLog", () => pageOf(EVERYONES));
    await openAt(AUDIT_LOG, api);
    await waitFor(() => {
      expect(lines()).toHaveLength(EVERYONES.length);
    });
    const typed = holdProcedure(api, "members.auditLog", pageOf([PRIYAS]));

    fireEvent.change(log().getByRole("searchbox", { name: "Search by person, group or action" }), {
      target: { value: "Priya" },
    });
    fireEvent.click(detailsOf(lineBy(BY_PRIYA)));
    await typed.asked;
    typed.resolve();

    await waitFor(() => {
      expect(lines()).toHaveLength(1);
    });
    const priyas = lineBy(BY_PRIYA);
    expect(
      detailsOf(priyas).getAttribute("aria-expanded"),
      "the details closed when the search finished",
    ).toBe("true");
    expect(within(priyas).getAllByRole("definition")[0]?.textContent).toBe(
      `Priya Shah${PRIYA_ADDRESS}`,
    );
  });
});
