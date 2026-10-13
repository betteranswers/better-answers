import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AUDIT_LOG_WORDS as WORDS } from "@/features/people/audit-log-words.ts";

import { placedWithoutMeasuring } from "./measuring.ts";
import { adaAnAdmin, heldBack, openAt } from "./two-workspaces.ts";

await vi.hoisted(() => import("./stub-server.ts"));

placedWithoutMeasuring();

/** What the api answers an export past its ceiling: no word, and the seconds until it lifts. */
const PAST_ITS_CEILING = {
  error: {
    message: "too many requests",
    code: -32_029,
    data: { code: "TOO_MANY_REQUESTS", httpStatus: 429, retryAfterSeconds: 61 },
  },
};

describe("an audit log export refused twice in one sentence", () => {
  it("empties its alert at the second press", async () => {
    const api = adaAnAdmin();
    api.set("members.exportAuditLog", () => PAST_ITS_CEILING);
    await openAt("/system/audit-log", api);
    const log = within(await screen.findByRole("region", { name: WORDS.heading }));
    const [alert] = log.getAllByRole("alert");
    if (alert === undefined) throw new Error("the audit log draws no alert");

    fireEvent.click(log.getByRole("button", { name: WORDS.export }));
    await waitFor(() => expect(alert.textContent).toMatch(/\b2\b/));

    const second = heldBack(api, "members.exportAuditLog", PAST_ITS_CEILING);
    fireEvent.click(log.getByRole("button", { name: WORDS.export }));
    await second.asked;

    expect(alert.textContent).toBe("");
    second.resolve();
    await waitFor(() => expect(alert.textContent).toMatch(/\b2\b/));
  });
});
