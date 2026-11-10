import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect } from "vitest";
import { z } from "zod";

import { createAppClients } from "@/app/providers.tsx";
import { BULK_WORDS, MEMBER_PAGE_WORDS } from "@/features/people/member-action-words.ts";
import type { Role } from "@/shared/navigation.ts";

import { drawApp, openApp } from "./open-app.tsx";
import { server, type Ask, type Asked } from "./stub-server.ts";
import { addressOf, answered, type Api } from "./stubbed-api.ts";

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

export const rateLimitedResponse = (waitSeconds: number): Response =>
  new Response(
    JSON.stringify({ error: "too_many_requests", error_description: "Too many requests." }),
    {
      status: 429,
      headers: { "content-type": "application/json", "retry-after": String(waitSeconds) },
    },
  );

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

const nextTask = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve);
  });

/** A tRPC batch keys inputs by position: in the URL for a query, in the body for a mutation. */
const inputsOf = (address: URL, init?: RequestInit): Readonly<Record<string, unknown>> => {
  const raw = address.searchParams.get("input") ?? init?.body;
  return typeof raw === "string" ? z.record(z.string(), z.unknown()).parse(JSON.parse(raw)) : {};
};

/** Starts a new request log, so a request an earlier test left in flight is logged there. */
const answering = (api: Api) => {
  const asks: Ask[] = [];
  server.asks = asks;
  return async (asked: Asked, init?: RequestInit): Promise<Response> => {
    const address = addressOf(asked);
    const { pathname } = address;
    await nextTask();
    if (!pathname.startsWith("/trpc/")) {
      const answer = api.get(pathname)?.() ?? A_SESSION;
      return answer instanceof Response ? answer : answered(answer);
    }

    const names = pathname.replace("/trpc/", "").split(",");
    const inputs = inputsOf(address, init);
    for (const [at, procedure] of names.entries()) {
      asks.push({ procedure, input: inputs[String(at)] });
    }
    const answers = names.map((name) => Promise.resolve(api.get(name)?.() ?? FORBIDDEN));
    return answered(await Promise.all(answers));
  };
};

export const band = () => within(screen.getByRole("banner"));

export const switcher = (workspace = NORTHERN) =>
  band().findByRole("button", { name: workspace.name });

export const switcherDrawn = (workspace = NORTHERN) =>
  band().queryByRole("button", { name: workspace.name });

export const tickOf = (name: string) => screen.queryByRole("checkbox", { name: `Select ${name}` });

export const changeTheTickedToViewer = async () => {
  fireEvent.click(screen.getByRole("button", { name: MEMBER_PAGE_WORDS.changeRole }));
  const dialog = await screen.findByRole("dialog", { name: BULK_WORDS.changeRole.title(1) });
  fireEvent.click(within(dialog).getByRole("button", { name: MEMBER_PAGE_WORDS.changeRole }));
};

export const openTab = (name: string) => {
  const tab = screen.getByRole("tab", { name });
  // Tabs open on mouse down, not on click.
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

export type Answering = typeof server.answer;

/** Renders the app immediately, as the browser does, without waiting for reads the first render needs. */
export const drawnAt = (path: string, api: Api, through: (answer: Answering) => Answering) => {
  server.answer = through(answering(api));
  return drawApp(path);
};

export const openPageOutsideShell = async (
  path: string,
  api: Api,
  watching?: (asked: Asked, init?: RequestInit) => void,
) => {
  const answer = answering(api);
  server.answer = (asked, init) => {
    watching?.(asked, init);
    return answer(asked, init);
  };
  const clients = createAppClients();
  clients.queryClient.setDefaultOptions({ queries: { retry: false } });
  const { router } = await openApp(path, clients);
  return router;
};
