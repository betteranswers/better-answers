import { readFileSync } from "node:fs";
import path from "node:path";

import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import type { inferInput, inferOutput } from "@trpc/tanstack-react-query";
import { afterEach, assert, describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  ANSWERING_WORKSPACE_HEADER,
  TAB_WORKSPACE_HEADER,
} from "@better-answers/schema/tab-workspace";

import { createAppClients, Providers, type AppClients } from "@/app/providers.tsx";
import { createAppRouter } from "@/app/router.tsx";
import { createApiProxy, TRPC_ENDPOINT, useTRPC } from "@/shared/api/trpc.ts";
import { memberOptions, NEEDS_A_PICK } from "@/shared/member/member.ts";
import { repositoryRoot } from "@test/roots.ts";
import { addressOf, answered } from "@test/stubbed-api.ts";
import { aRefusalAnswer, read } from "@test/two-workspaces.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type ListProcedure = ReturnType<typeof useTRPC>["modelChoices"]["list"];

function ModelChoicesProbe() {
  const api = useTRPC();
  const options = api.modelChoices.list.queryOptions();
  return <p data-testid="probe">{JSON.stringify(options.queryKey)}</p>;
}

describe("the SPA's tRPC client", () => {
  it("hands a component its query options, keyed by the procedure", () => {
    render(
      <Providers clients={createAppClients()}>
        <ModelChoicesProbe />
      </Providers>,
    );

    expect(JSON.parse(screen.getByTestId("probe").textContent)).toEqual([
      ["modelChoices", "list"],
      { type: "query" },
    ]);
  });

  it("throws for a component rendered outside the provider", () => {
    expect(() => render(<ModelChoicesProbe />)).toThrow(/TRPCProvider/);
  });
});

describe("the query provider above the router", () => {
  it("wraps the router, so its pages share one tRPC client", async () => {
    const clients = createAppClients();
    const router = createAppRouter(
      clients,
      createMemoryHistory({ initialEntries: ["/models/models-and-spend"] }),
    );
    await router.load();

    render(
      <Providers clients={clients}>
        <RouterProvider router={router} />
        <ModelChoicesProbe />
      </Providers>,
    );

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Models");
    expect(screen.getByTestId("probe").textContent).toContain("modelChoices");
  });
});

type Session = { in: string | undefined; memberReads: number };

const answeredFrom = (body: unknown, workspaceId: string): Promise<Response> =>
  Promise.resolve(Response.json(body, { headers: { [ANSWERING_WORKSPACE_HEADER]: workspaceId } }));

const anApiHearingActions = () => {
  const named: (string | null)[] = [];
  const session: Session = { in: "w", memberReads: 0 };
  vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
    const { pathname } = addressOf(input);
    if (pathname.endsWith("/members.createGroup")) {
      named.push(new Headers(init?.headers).get(TAB_WORKSPACE_HEADER));
    }
    const reading = ["/members.groups", "/session.member"].find((suffix) =>
      pathname.endsWith(suffix),
    );
    if (reading === undefined) return answered([read(null)]);
    if (reading === "/session.member") session.memberReads += 1;
    if (session.in === undefined) {
      return answered([aRefusalAnswer(NEEDS_A_PICK, "unauthenticated", 401)]);
    }
    if (reading === "/members.groups") return answeredFrom([read([])], session.in);
    const member = {
      workspace: { id: session.in, name: "Northern Tooling" },
      person: { id: "p", name: "Ada", email: "ada@example.test" },
      role: "Admin",
    };
    return answeredFrom([read(member)], session.in);
  });
  return { named, session };
};

const memberRead = (clients: AppClients) =>
  clients.queryClient.query(memberOptions(createApiProxy(clients.apiClient, clients.queryClient)));

const memberKeyOf = (clients: AppClients) =>
  memberOptions(createApiProxy(clients.apiClient, clients.queryClient)).queryKey;

const groupsRead = (clients: AppClients) => clients.apiClient.members.groups.query();

const groupMade = (clients: AppClients) =>
  clients.apiClient.members.createGroup.mutate({ name: "Bid writers" });

const leavesCounted = (clients: AppClients) => {
  const left = { times: 0 };
  clients.shown.whenLeft(() => {
    left.times += 1;
  });
  return left;
};

describe("the workspace an action names", () => {
  it("is the held member read's, as each action is sent", async () => {
    const { named, session } = anApiHearingActions();
    const clients = createAppClients();

    await memberRead(clients);
    await groupMade(clients);
    session.in = "v";
    await memberRead(clients);
    await groupMade(clients);

    expect(named).toEqual(["w", "v"]);
  });

  it("is the last shown while the member is read again", async () => {
    const { named, session } = anApiHearingActions();
    const clients = createAppClients();

    await memberRead(clients);
    await clients.queryClient.resetQueries({ queryKey: memberKeyOf(clients) });
    session.in = "v";
    await groupMade(clients);

    expect(named).toEqual(["w"]);
  });

  it("is the one a read was answered from, member unread", async () => {
    const { named, session } = anApiHearingActions();
    const clients = createAppClients();

    await groupsRead(clients);
    session.in = "v";
    await groupMade(clients);

    expect(named).toEqual(["w"]);
    expect(session.memberReads, "the action read the member").toBe(0);
  });

  it("is none, reading nothing, once the member read is refused", async () => {
    const { named, session } = anApiHearingActions();
    session.in = undefined;
    const clients = createAppClients();

    await expect(memberRead(clients)).rejects.toThrow("no-active-workspace");
    await groupMade(clients);

    expect(named).toEqual([null]);
    expect(session.memberReads, "the action read the member again").toBe(1);
  });

  it("is none once the tab's cache is cleared on sign-out", async () => {
    const { named } = anApiHearingActions();
    const clients = createAppClients();
    await memberRead(clients);

    clients.queryClient.clear();
    await groupMade(clients);

    expect(named).toEqual([null]);
  });

  it("is none while the tab holds no member read", async () => {
    const { named } = anApiHearingActions();
    const clients = createAppClients();

    await groupMade(clients);

    expect(named).toEqual([null]);
  });
});

describe("a tab whose reads were answered before its member read", () => {
  it("is left when a later answer comes from another workspace", async () => {
    const { session } = anApiHearingActions();
    const clients = createAppClients();
    const left = leavesCounted(clients);

    await groupsRead(clients);
    session.in = "v";
    await groupsRead(clients);
    await groupsRead(clients);

    expect(left.times).toBe(1);
  });

  it("is left when its member read lands in another workspace", async () => {
    const { session } = anApiHearingActions();
    const clients = createAppClients();
    const left = leavesCounted(clients);

    await groupsRead(clients);
    session.in = "v";
    await memberRead(clients);

    expect(left.times).toBe(1);
  });

  it("stays when its member read lands where reads were answered", async () => {
    anApiHearingActions();
    const clients = createAppClients();
    const left = leavesCounted(clients);

    await groupsRead(clients);
    await memberRead(clients);

    expect(left.times).toBe(0);
  });

  it("is not left by a member read moving between workspaces", async () => {
    const { session } = anApiHearingActions();
    const clients = createAppClients();
    const left = leavesCounted(clients);

    await memberRead(clients);
    session.in = "v";
    await memberRead(clients);

    expect(left.times).toBe(0);
  });
});

type Heard = {
  readonly method: string | undefined;
  readonly address: URL;
  readonly body: string;
  readonly named: string | null;
};

const anApiHearingAsks = () => {
  const heard: Heard[] = [];
  vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
    const address = addressOf(input);
    if (!address.pathname.includes("ask.question")) {
      return answered([{ result: { data: { workspace: { id: "w" } } } }]);
    }
    heard.push({
      method: init?.method,
      address,
      body: typeof init?.body === "string" ? init.body : "",
      named: new Headers(init?.headers).get(TAB_WORKSPACE_HEADER),
    });
    return Promise.resolve(new Response("", { status: 503 }));
  });
  return heard;
};

const A_QUESTION = "How long are audit logs kept for buyers?";

describe("an ask the web sends", () => {
  it("is a POST whose address holds none of the question", async () => {
    const heard = anApiHearingAsks();
    const clients = createAppClients();
    await memberRead(clients);

    await clients.apiClient.ask.question.mutate({ question: A_QUESTION }).catch(() => undefined);

    expect(heard.map(({ method, named }) => [method, named])).toEqual([["POST", "w"]]);
    const [sent] = heard;
    assert(sent !== undefined, "the ask was heard");
    expect(sent.address.href).not.toMatch(/audit|logs|kept/i);
    expect(decodeURIComponent(sent.address.href)).not.toContain(A_QUESTION);
    expect(sent.body).toContain(A_QUESTION);
  });

  it("is sent alone, though another action leaves with it", async () => {
    const heard = anApiHearingAsks();
    const clients = createAppClients();

    await Promise.allSettled([
      clients.apiClient.ask.question.mutate({ question: A_QUESTION }),
      groupMade(clients),
    ]);

    expect(heard.map(({ address }) => address.pathname)).toEqual([`${TRPC_ENDPOINT}/ask.question`]);
  });

  it("is sent once, though the api failed it", async () => {
    const heard = anApiHearingAsks();
    const clients = createAppClients();

    const refused = await clients.apiClient.ask.question.mutate({ question: A_QUESTION }).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(refused).toBeInstanceOf(Error);
    expect(heard).toHaveLength(1);
  });
});

describe("the path the tRPC client and the api agree on", () => {
  it("matches the one path apps/api mounts its router at", () => {
    const source = readFileSync(path.join(repositoryRoot, "apps/api/src/trpc/mount.ts"), "utf8");
    const declared = [...source.matchAll(/^export const TRPC_ENDPOINT = "(?<path>[^"]+)";$/gm)];

    expect(declared).toHaveLength(1);
    expect(declared[0]?.groups?.["path"]).toBe(TRPC_ENDPOINT);
  });
});

describe("modelChoices.list's types crossing from apps/api", () => {
  it("takes no input, since the session carries the workspace", () => {
    /**
     * `toEqualTypeOf` constrains its argument, so absence is asserted through a conditional,
     * written both ways round so a widened input fails it too.
     */
    type NoInput = [inferInput<ListProcedure>] extends [void | undefined]
      ? [void | undefined] extends [inferInput<ListProcedure>]
        ? true
        : false
      : false;
    expectTypeOf<NoInput>().toEqualTypeOf<true>();
  });

  it("answers one model choice per purpose, in a page's words", () => {
    type ModelChoice = inferOutput<ListProcedure>[number];

    type ExpectedModelChoice = {
      readonly purpose: "extraction" | "enrichment" | "answering" | "judging" | "embedding";
      readonly provider: string | null;
      readonly model: string | null;
      readonly dimensions: number | null;
      readonly fixed: boolean;
      readonly retentionTail: string | null;
    };

    expectTypeOf<ModelChoice>().toEqualTypeOf<ExpectedModelChoice>();
  });
});
