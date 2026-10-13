import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect } from "vitest";

import { createAppClients } from "@/app/providers.tsx";
import { FAILED_PAGE, RAIL } from "@/app/words.ts";
import { BULK_WORDS } from "@/features/people/member-action-words.ts";
import { CONTROL_CENTRE, type Role } from "@/shared/navigation.ts";

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

/** In Holme Valley Tools only, so a row of hers is never one of the workspace left. */
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

/** What the stub answers a read no test names, so a page draws its own state. */
export const FORBIDDEN = aRefusalAnswer("forbidden", "forbidden", 403);

/** A read that failed in no word, which sends the reader nowhere. */
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

/** Each answer by its procedure's name, or by its path where the route is not tRPC's. */
export type Api = Map<string, () => unknown>;

/** Ada, an Admin of Northern Tooling beside Grace, and a Viewer of Holme Valley Tools. */
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

/** Another tab points the session at Holme Valley Tools, where Ada holds `role`. */
export const aSwitchInAnotherTab = (api: Api, role: Role, members = [ADA, HEDY]) => {
  api.set("session.member", () => adaAt(role, HOLME));
  api.set("members.list", () => read(members));
  api.set("members.invitations", () => read([]));
};

/** An answer the api gives only once the test lets it; `asked` settles when the request arrives. */
export const heldBack = (api: Api, procedure: string, answer: unknown) => {
  const asked = Promise.withResolvers<void>();
  const held = Promise.withResolvers<void>();
  api.set(procedure, () => {
    asked.resolve();
    return held.promise.then(() => answer);
  });
  return { asked: asked.promise, resolve: held.resolve };
};

/**
 * A turn of the event loop later, as a network answers: sooner, the answer lands before the frame
 * hears its member read change.
 */
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
    // Resolved each, since one answer may be a promise the test holds back.
    const answers = names.map((name) => Promise.resolve(api.get(name)?.() ?? FORBIDDEN));
    return answered(await Promise.all(answers));
  };

export const band = () => within(screen.getByRole("banner"));

export const switcher = (workspace = NORTHERN) =>
  band().findByRole("button", { name: workspace.name });

export const switcherDrawn = (workspace = NORTHERN) =>
  band().queryByRole("button", { name: workspace.name });

export const tickOf = (name: string) => screen.queryByRole("checkbox", { name: `Select ${name}` });

/** The one ticked member's role, sent to change to Viewer through the bar's dialog. */
export const changeTheTickedToViewer = async () => {
  fireEvent.click(screen.getByRole("button", { name: BULK_WORDS.changeRole.action }));
  const dialog = await screen.findByRole("dialog", { name: BULK_WORDS.changeRole.title(1) });
  fireEvent.click(within(dialog).getByRole("button", { name: BULK_WORDS.changeRole.action }));
};

export const openTab = (name: string) => {
  const tab = screen.getByRole("tab", { name });
  // The registry's tabs open on a press, never on a click.
  fireEvent.mouseDown(tab);
};

/** An Admin's own area, which the rail offers no other role. */
export const adminsAreaOffered = () =>
  within(screen.getByRole("navigation", { name: RAIL })).queryByRole("link", {
    name: CONTROL_CENTRE.name,
  });

/** The frame after a member read that failed: no name of the workspace left, and a way to retry. */
export const drawnWithNoWorkspace = async () => {
  await waitFor(() => expect(screen.queryByText(NORTHERN.name, { exact: false })).toBeNull());
  expect(await screen.findByRole("heading", { level: 1, name: FAILED_PAGE.heading })).toBeDefined();
};

/** The whole web at `path`, drawn as far as the band's workspace; no failed read is asked again. */
export const openAt = async (path: string, api: Api) => {
  server.answer = answering(api);
  const clients = createAppClients();
  clients.queryClient.setDefaultOptions({ queries: { retry: false } });
  const { router } = await openApp(path, clients);
  await switcher();
  return router;
};
