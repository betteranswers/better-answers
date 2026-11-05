import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { openApp } from "@test/open-app.tsx";
import { server, type Asked } from "@test/stub-server.ts";
import { addressOf, answered } from "@test/stubbed-api.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

afterEach(cleanup);

const NORTHERN = { workspace: { id: "w", name: "Northern Tooling" }, role: "Admin" };

const SOUTHERN = { workspace: { id: "x", name: "Southern Castings" }, role: "Viewer" };

const A_SESSION = { session: { id: "s" }, user: { id: "p", name: "Ada" } };

const NEEDS_A_PICK = {
  error: {
    message: "no-active-workspace",
    code: -32_001,
    data: {
      code: "UNAUTHORIZED",
      httpStatus: 401,
      refusal: { word: "no-active-workspace", class: "unauthenticated" },
    },
  },
};

const refused = (): Promise<Response> =>
  Promise.resolve(Response.json({ code: "FORBIDDEN", message: "refused" }, { status: 403 }));

const everyPickRefused =
  (held: readonly unknown[]) =>
  (asked: Asked): Promise<Response> => {
    const { pathname } = addressOf(asked);
    if (pathname === "/organization/set-active") return refused();
    if (!pathname.startsWith("/trpc/")) return answered(A_SESSION);
    const names = pathname.replace("/trpc/", "").split(",");
    return answered(
      names.map((name) =>
        name === "person.workspaces" ? { result: { data: held } } : NEEDS_A_PICK,
      ),
    );
  };

const alertSays = () => screen.getByRole("alert").textContent;

describe("choosing a workspace the api refuses", () => {
  it("shows an alert and no buttons for the only workspace", async () => {
    server.answer = everyPickRefused([NORTHERN]);

    await openApp("/choose-workspace");

    await waitFor(() => {
      expect(alertSays()).toMatch(/\S/u);
    });
    expect(screen.queryAllByRole("button")).toEqual([]);
  });

  it("shows an alert and keeps the workspace list", async () => {
    server.answer = everyPickRefused([NORTHERN, SOUTHERN]);
    await openApp("/choose-workspace");

    fireEvent.click(await screen.findByRole("button", { name: SOUTHERN.workspace.name }));

    await waitFor(() => {
      expect(alertSays()).toMatch(/\S/u);
    });
    expect(screen.getByRole("button", { name: SOUTHERN.workspace.name })).toBeDefined();
  });
});
