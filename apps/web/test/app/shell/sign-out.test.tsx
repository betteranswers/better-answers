import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

import { HOMES } from "@/shared/navigation.ts";
import { SIGN_OUT } from "@/shared/words.ts";
import {
  rateLimitedResponse,
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

it("shows the wait and keeps the page on refused sign-out", async () => {
  const api = adaAnAdmin();
  api.set("/sign-out", () => rateLimitedResponse(WAIT_SECONDS));
  const router = await openAt(HOMES.Admin.path, api);
  const alert = band().getByRole("alert");
  expect(alert.textContent, "the band alert had text before sign-out").toBe("");

  await userEvent.click(band().getByRole("button", { name: ADA.displayName }));
  await userEvent.click(await screen.findByRole("menuitem", { name: SIGN_OUT }));

  await vi.waitFor(() => expect(alert.textContent).toMatch(/\b2 minutes\b/));
  expect(router.state.location.pathname, "the refused sign-out navigated away").toBe(
    HOMES.Admin.path,
  );
  expect(
    switcherDrawn(NORTHERN),
    "the refused sign-out removed the workspace switcher",
  ).not.toBeNull();
});
