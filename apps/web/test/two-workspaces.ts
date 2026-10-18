import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect } from "vitest";

import { createAppClients } from "@/app/providers.tsx";
import type { Role } from "@/shared/navigation.ts";

import { openApp } from "./open-app.tsx";
import { server, type Asked } from "./stub-server.ts";
import { addressOf, answered } from "./stubbed-api.ts";

export const NORTHERN = { id: "w", name: "Northern Tooling" };

export const HOLME = { id: "h", name: "Holme Valley Tools" };

export const ADA = {
  personId: "01JADA0000000000000000000A",
  displayName: "Ada",
  address: "ada@example.test",
  role: "Admin",
  joinedAt: "2026-03-04T09:00:00.000Z",
  credentialsRevokedAt: null,
  groups: [],
};

export const GRACE = { ...ADA, personId: "01JGRACE00000000000000000A", displayName: "Grace" };

export const HEDY = { ...ADA, personId: "01JHEDY000000000000000000A", displayName: "Hedy" };

const A_SESSION = {
  session: { activeOrganizationId: NORTHERN.id },
  user: { id: ADA.personId, name: ADA.displayName },
};

export const read = (data: unknown) => ({ result: { data } });

export const aRefusalAnswer = (word: string, refusalClass: string, httpStatus: number) => ({
  error: {
    message: word,
    code: -32_001,
    data: { code: "REFUSED", httpStatus, refusal: { word, class: refusalClass } },
  },
});

export const FORBIDDEN = aRefusalAnswer("forbidden", "forbidden", 403);

export const LOST = {
  error: {
    message: "lost",
    code: -32_603,
    data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 },
  },
};

export const adaAt = (role: Role, workspace = NORTHERN) =>
  read({
    workspace,
    person: { id: ADA.personId, name: ADA.displayName, email: ADA.address },
    role,
  });

export type Api = Map<string, () => unknown>;

export const adaAnAdmin = (): Api =>
  new Map<string, () => unknown>([
    ["session.member", () => adaAt("Admin")],
    ["session.operator", () => read({ operator: false, name: ADA.displayName })],
    ["members.list", () => read([ADA, GRACE])],
    [
      "person.workspaces",
      () =>
        read([
          { workspace: NORTHERN, role: "Admin" },
          { workspace: HOLME, role: "Viewer" },
        ]),
    ],
  ]);

export const aSwitchInAnotherTab = (api: Api, role: Role, members = [ADA, HEDY]) => {
  api.set("session.member", () => adaAt(role, HOLME));
  api.set("members.list", () => read(members));
  api.set("members.invitations", () => read([]));
};

export const heldBack = (api: Api, procedure: string, answer: unknown) => {
  const asked = Promise.withResolvers<void>();
  const held = Promise.withResolvers<void>();
  api.set(procedure, () => {
    asked.resolve();
    return held.promise.then(() => answer);
  });
  return { asked: asked.promise, resolve: held.resolve };
};

const aTurnLater = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve);
  });

const answering =
  (api: Api) =>
  async (asked: Asked): Promise<Response> => {
    const { pathname } = addressOf(asked);
    await aTurnLater();
    if (!pathname.startsWith("/trpc/")) return answered(api.get(pathname)?.() ?? A_SESSION);

    const names = pathname.replace("/trpc/", "").split(",");
    const answers = names.map((name) => Promise.resolve(api.get(name)?.() ?? FORBIDDEN));
    return answered(await Promise.all(answers));
  };

export const band = () => within(screen.getByRole("banner"));

export const switcher = (workspace = NORTHERN) =>
  band().findByRole("button", { name: workspace.name });

export const switcherDrawn = (workspace = NORTHERN) =>
  band().queryByRole("button", { name: workspace.name });

export const tickOf = (name: string) => screen.queryByRole("checkbox", { name: `Select ${name}` });

export const changeTheTickedToViewer = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Change Role" }));
  const dialog = await screen.findByRole("dialog", { name: "Change Role for 1 Member" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Change Role" }));
};

export const openTab = (name: string) => {
  const tab = screen.getByRole("tab", { name });
  // The registry's tabs open on a press, never on a click.
  fireEvent.mouseDown(tab);
};

export const adminsAreaOffered = () =>
  within(screen.getByRole("navigation", { name: "Areas" })).queryByRole("link", {
    name: "Control Centre",
  });

export const drawnWithNoWorkspace = async () => {
  await waitFor(() => expect(screen.queryByText(NORTHERN.name, { exact: false })).toBeNull());
  expect(
    await screen.findByRole("heading", { level: 1, name: "This Page Didn’t Load" }),
  ).toBeDefined();
};

export const openAt = async (path: string, api: Api) => {
  server.answer = answering(api);
  const clients = createAppClients();
  clients.queryClient.setDefaultOptions({ queries: { retry: false } });
  const { router } = await openApp(path, clients);
  await switcher();
  return router;
};
