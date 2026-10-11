import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createAppClients } from "@/app/providers.tsx";
import { FAILED_PAGE, RAIL } from "@/app/words.ts";
import { MEMBER_PAGE_WORDS } from "@/features/people/member-action-words.ts";
import { memberPageOf } from "@/features/people/members-address.ts";
import { CONTROL_CENTRE, HOMES, type Role } from "@/shared/navigation.ts";

import { placedWithoutMeasuring } from "./measuring.ts";
import { openApp } from "./open-app.tsx";
import { addressOf, answered } from "./stubbed-api.ts";

type Asked = string | URL | Request;

/** Better Auth's client keeps the `fetch` it finds when made, so this one stands first. */
const server = vi.hoisted(() => {
  const held = {
    answer: (_asked: Asked): Promise<Response> => Promise.reject(new TypeError("unanswered")),
  };
  globalThis.fetch = (asked: Asked) => held.answer(asked);
  return held;
});

placedWithoutMeasuring();

const NORTHERN = { id: "w", name: "Northern Tooling" };

const HOLME = { id: "h", name: "Holme Valley Tools" };

const CALDER = { id: "c", name: "Calder Pressings" };

const ADA = {
  personId: "01JADA0000000000000000000A",
  displayName: "Ada",
  address: "ada@example.test",
  role: "Admin",
  joinedAt: "2026-03-04T09:00:00.000Z",
  credentialsRevokedAt: null,
  groups: [],
};

const GRACE = { ...ADA, personId: "01JGRACE00000000000000000A", displayName: "Grace" };

const A_SESSION = {
  session: { activeOrganizationId: NORTHERN.id },
  user: { id: ADA.personId, name: ADA.displayName },
};

const read = (data: unknown) => ({ result: { data } });

const refusedWith = (word: string, refusalClass: string, httpStatus: number) => ({
  error: {
    message: word,
    code: -32_001,
    data: { code: "REFUSED", httpStatus, refusal: { word, class: refusalClass } },
  },
});

/** What the stub answers a read no test names, so a page draws its own state. */
const FORBIDDEN = refusedWith("forbidden", "forbidden", 403);

/** What the api answers every read of a workspace the session names and the person has left. */
const NOT_A_MEMBER = refusedWith("not-a-member", "unauthenticated", 401);

/** A read that failed in no word, which sends the reader nowhere. */
const LOST = {
  error: {
    message: "lost",
    code: -32_603,
    data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 },
  },
};

const adaAt = (role: Role) =>
  read({
    workspace: NORTHERN,
    person: { id: ADA.personId, name: ADA.displayName, email: ADA.address },
    role,
  });

/** Each answer by its procedure's name, or by its path where the route is not tRPC's. */
type Api = Map<string, () => unknown>;

const SET_ACTIVE = "/organization/set-active";

/** Ada, an Admin of Northern Tooling beside Grace, and a Viewer of Holme Valley Tools. */
const adaAnAdmin = (): Api =>
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

const band = () => within(screen.getByRole("banner"));

const switcher = () => band().findByRole("button", { name: NORTHERN.name });

const switcherDrawn = () => band().queryByRole("button", { name: NORTHERN.name });

/** An Admin's own area, which the rail offers no other role. */
const adminsAreaOffered = () =>
  within(screen.getByRole("navigation", { name: RAIL })).queryByRole("link", {
    name: CONTROL_CENTRE.name,
  });

/** The whole app at `path`, drawn as far as the band's workspace; no failed read is asked again. */
const openAt = async (path: string, api: Api) => {
  server.answer = answering(api);
  const clients = createAppClients();
  clients.queryClient.setDefaultOptions({ queries: { retry: false } });
  const { router } = await openApp(path, clients);
  await switcher();
  return router;
};

const MEMBER_PAGE = memberPageOf(ADA.personId);

/** Ada's own page, with Editor picked and the change pressed. */
const ROLE_CHANGED = read({ personId: ADA.personId, previousRole: "Admin", role: "Editor" });

/** `memberAfter` is what the member read answers once the change has landed. */
const demotingHerself = async (api: Api, memberAfter: Parameters<Api["set"]>[1]) => {
  api.set("members.changeRole", () => {
    api.set("session.member", memberAfter);
    api.set("members.list", () => read([{ ...ADA, role: "Editor" }, GRACE]));
    return ROLE_CHANGED;
  });
  const router = await openAt(MEMBER_PAGE, api);
  fireEvent.click(await screen.findByRole("radio", { name: "Editor" }));
  fireEvent.click(
    screen.getByRole("button", { name: MEMBER_PAGE_WORDS.makeRole(ADA.displayName, "Editor") }),
  );
  return router;
};

describe("a change to the reader's own member", () => {
  it("lands a self-removed Admin at the chooser, drawing no role", async () => {
    const api = adaAnAdmin();
    const landing = Promise.withResolvers<void>();
    api.set("members.remove", () => {
      api.set("session.member", () => NOT_A_MEMBER);
      api.set("members.list", () => NOT_A_MEMBER);
      // Two are left, so the chooser stands rather than opening the only one.
      api.set("person.workspaces", () =>
        read([
          { workspace: HOLME, role: "Viewer" },
          { workspace: CALDER, role: "Viewer" },
        ]),
      );
      // The chooser reads this before it draws, so the frame stands until the test lets it answer.
      api.set("person.secondFactor", () => landing.promise.then(() => FORBIDDEN));
      return read({});
    });
    const router = await openAt(MEMBER_PAGE, api);

    fireEvent.click(await screen.findByRole("button", { name: "Remove Ada" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Ada from this workspace" }));

    await waitFor(() => expect(switcherDrawn(), "the band names the workspace left").toBeNull());
    expect(adminsAreaOffered(), "the rail offers the role lost").toBeNull();

    landing.resolve();
    expect(await screen.findByRole("button", { name: HOLME.name })).toBeDefined();
    expect(router.state.location.pathname).toBe("/choose-workspace");
    expect(screen.queryByRole("navigation", { name: RAIL })).toBeNull();
  });

  it("drops the left workspace's name when a switch's re-read fails", async () => {
    const api = adaAnAdmin();
    api.set(SET_ACTIVE, () => {
      api.set("session.member", () => LOST);
      return { id: HOLME.id };
    });
    const router = await openAt("/people/members", api);

    fireEvent.keyDown(await switcher(), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("menuitemradio", { name: `${HOLME.name} Viewer` }));

    await waitFor(() => expect(screen.queryByText(NORTHERN.name, { exact: false })).toBeNull());
    expect(
      await screen.findByRole("heading", { level: 1, name: FAILED_PAGE.heading }),
    ).toBeDefined();
    expect(router.state.location.pathname).toBe("/");
  });

  it("lands a self-demoted Admin at an Editor's home, saying why", async () => {
    const router = await demotingHerself(adaAnAdmin(), () => adaAt("Editor"));

    expect(
      await screen.findByText(
        "You changed your own role to Editor. People is for Admins, so this is your home now.",
      ),
    ).toBeDefined();
    expect(router.state.location.pathname).toBe(HOMES.Editor.path);
    expect(adminsAreaOffered(), "the rail offers the role lost").toBeNull();
  });

  it("keeps a self-demoted Admin put, told the role is unread", async () => {
    const router = await demotingHerself(adaAnAdmin(), () => LOST);

    expect(
      await screen.findByText(
        "Your role changed, but it couldn’t be read again. Reload the page in a moment.",
      ),
    ).toBeDefined();
    expect(router.state.location.pathname).toBe(MEMBER_PAGE);
    expect(switcherDrawn(), "the page lost the workspace it was drawn for").not.toBeNull();
    expect(adminsAreaOffered(), "the page lost the role it was drawn for").not.toBeNull();
  });
});
