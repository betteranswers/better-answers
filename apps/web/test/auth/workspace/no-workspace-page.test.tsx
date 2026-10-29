import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { ASK_TO_JOIN_WORDS } from "@/features/auth/workspace/ask-to-join-words.ts";
import { ADA, adaAnAdmin, openOutsideTheShellAt, read } from "@test/two-workspaces.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const SIGNED_IN_WITH_NONE_OPEN = {
  session: { id: "s" },
  user: { id: ADA.personId, name: ADA.displayName, email: ADA.address },
};

it("offers one way on to a person in no workspace", async () => {
  const api = adaAnAdmin();
  api.set("/get-session", () => SIGNED_IN_WITH_NONE_OPEN);
  api.set("person.invitations", () => read([]));
  api.set("/sign-out", () => ({ success: true }));
  await openOutsideTheShellAt("/no-workspace", api);

  expect(await screen.findByRole("region", { name: ASK_TO_JOIN_WORDS.heading })).toBeDefined();

  expect(screen.queryByRole("button", { name: /create/i })).toBeNull();
  expect(screen.queryByRole("link", { name: /create/i })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Sign Out" }));

  expect(await screen.findByRole("heading", { level: 1, name: "Sign In" })).toBeDefined();
});
