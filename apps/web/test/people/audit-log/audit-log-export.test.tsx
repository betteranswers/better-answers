import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { assert, describe, expect, it, vi } from "vitest";

import { AUDIT_LOG_WORDS } from "@/features/people/audit-log/audit-log-words.ts";
import { placedWithoutMeasuring } from "@test/measuring.ts";
import { holdProcedure } from "@test/stubbed-api.ts";
import { adaAnAdmin, openAt } from "@test/two-workspaces.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

placedWithoutMeasuring();

const PAST_ITS_CEILING = {
  error: {
    message: "too many requests",
    code: -32_029,
    data: { code: "TOO_MANY_REQUESTS", httpStatus: 429, retryAfterSeconds: 61 },
  },
};

describe("an audit log export refused twice in a row", () => {
  it("clears the alert when Export is pressed again", async () => {
    const api = adaAnAdmin();
    api.set("members.exportAuditLog", () => PAST_ITS_CEILING);
    await openAt("/system/audit-log", api);
    const log = within(await screen.findByRole("region", { name: "Audit Log" }));
    const [alert] = log.getAllByRole("alert");
    assert(alert !== undefined, "the audit log has no alert region");

    fireEvent.click(log.getByRole("button", { name: AUDIT_LOG_WORDS.export }));
    await waitFor(() => expect(alert.textContent).toMatch(/\b2\b/));

    const second = holdProcedure(api, "members.exportAuditLog", PAST_ITS_CEILING);
    fireEvent.click(log.getByRole("button", { name: AUDIT_LOG_WORDS.export }));
    await second.asked;

    expect(alert.textContent).toBe("");
    second.resolve();
    await waitFor(() => expect(alert.textContent).toMatch(/\b2\b/));
  });
});
