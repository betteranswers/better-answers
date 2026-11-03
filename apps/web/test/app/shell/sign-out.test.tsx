import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

import { HOMES } from "@/shared/navigation.ts";
import {
  aCeilingMet,
  ADA,
  adaAnAdmin,
  band,
  NORTHERN,
  openAt,
  switcherDrawn,
} from "@test/two-workspaces.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

afterEach(cleanup);

const WAIT_SECONDS = 120;

it("a refused sign-out keeps the page and says the wait", async () => {
  const api = adaAnAdmin();
  api.set("/sign-out", () => aCeilingMet(WAIT_SECONDS));
  const router = await openAt(HOMES.Admin.path, api);
  const alert = band().getByRole("alert");
  expect(alert.textContent, "the band says nothing before a sign-out").toBe("");

  await userEvent.click(band().getByRole("button", { name: ADA.displayName }));
  await userEvent.click(await screen.findByRole("menuitem", { name: "Sign Out" }));

  await vi.waitFor(() => expect(alert.textContent).toMatch(/\b2 minutes\b/));
  expect(router.state.location.pathname, "a refused sign-out left the page").toBe(HOMES.Admin.path);
  expect(switcherDrawn(NORTHERN), "a refused sign-out dropped the workspace").not.toBeNull();
});
