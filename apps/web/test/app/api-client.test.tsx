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
import { rootsOf } from "@better-answers/schema/testing/roots";

import { createAppClients, Providers, type AppClients } from "@/app/providers.tsx";
import { createAppRouter } from "@/app/router.tsx";
import { createApiProxy, TRPC_ENDPOINT, useTRPC } from "@/shared/api/trpc.ts";
import { memberOptions, NEEDS_A_PICK } from "@/shared/member/member.ts";
import { CONTROL_CENTRE, menuGroupIn, pageById } from "@/shared/navigation.ts";
import { addressOf, answered } from "@test/stubbed-api.ts";
import { aRefusalAnswer, read } from "@test/two-workspaces.ts";

const { repositoryRoot } = rootsOf(import.meta.url);

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
  it("gives a component query options keyed by the procedure", () => {
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

describe("the app providers", () => {
  it("share one tRPC client across the router and other components", async () => {
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

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      pageById(menuGroupIn(CONTROL_CENTRE, "models"), "models-and-spend").name,
    );
    expect(screen.getByTestId("probe").textContent).toContain("modelChoices");
  });
});

type Session = { workspaceId: string | undefined; memberReads: number };

const answeredByWorkspace = (body: unknown, workspaceId: string): Promise<Response> =>
  Promise.resolve(Response.json(body, { headers: { [ANSWERING_WORKSPACE_HEADER]: workspaceId } }));

const stubApiRecordingActions = () => {
  const sentWorkspaces: (string | null)[] = [];
  const session: Session = { workspaceId: "w", memberReads: 0 };
  vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
    const { pathname } = addressOf(input);
    if (pathname.endsWith("/members.createGroup")) {
      sentWorkspaces.push(new Headers(init?.headers).get(TAB_WORKSPACE_HEADER));
    }
    const readPath = ["/members.groups", "/session.member"].find((suffix) =>
      pathname.endsWith(suffix),
    );
    if (readPath === undefined) return answered([read(null)]);
    if (readPath === "/session.member") session.memberReads += 1;
    if (session.workspaceId === undefined) {
      return answered([aRefusalAnswer(NEEDS_A_PICK, "unauthenticated", 401)]);
    }
    if (readPath === "/members.groups") return answeredByWorkspace([read([])], session.workspaceId);
    const member = {
      workspace: { id: session.workspaceId, name: "Northern Tooling" },
      person: { id: "p", name: "Ada", email: "ada@example.test" },
      role: "Admin",
    };
    return answeredByWorkspace([read(member)], session.workspaceId);
  });
  return { sentWorkspaces, session };
};

const readMember = (clients: AppClients) =>
  clients.queryClient.query(memberOptions(createApiProxy(clients.apiClient, clients.queryClient)));

const memberKeyOf = (clients: AppClients) =>
  memberOptions(createApiProxy(clients.apiClient, clients.queryClient)).queryKey;

const readGroups = (clients: AppClients) => clients.apiClient.members.groups.query();

const createGroup = (clients: AppClients) =>
  clients.apiClient.members.createGroup.mutate({ name: "Bid writers" });

const countWorkspaceLeaves = (clients: AppClients) => {
  const leaves = { times: 0 };
  clients.shown.whenLeft(() => {
    leaves.times += 1;
  });
  return leaves;
};

describe("the workspace header on an action", () => {
  it("comes from the cached member when each action is sent", async () => {
    const { sentWorkspaces, session } = stubApiRecordingActions();
    const clients = createAppClients();

    await readMember(clients);
    await createGroup(clients);
    session.workspaceId = "v";
    await readMember(clients);
    await createGroup(clients);

    expect(sentWorkspaces).toEqual(["w", "v"]);
  });

  it("keeps the last workspace while the member is refetched", async () => {
    const { sentWorkspaces, session } = stubApiRecordingActions();
    const clients = createAppClients();

    await readMember(clients);
    await clients.queryClient.resetQueries({ queryKey: memberKeyOf(clients) });
    session.workspaceId = "v";
    await createGroup(clients);

    expect(sentWorkspaces).toEqual(["w"]);
  });

  it("comes from a read's answer before the member is read", async () => {
    const { sentWorkspaces, session } = stubApiRecordingActions();
    const clients = createAppClients();

    await readGroups(clients);
    session.workspaceId = "v";
    await createGroup(clients);

    expect(sentWorkspaces).toEqual(["w"]);
    expect(session.memberReads, "sending the action fetched the member").toBe(0);
  });

  it("is absent without a refetch after the member read fails", async () => {
    const { sentWorkspaces, session } = stubApiRecordingActions();
    session.workspaceId = undefined;
    const clients = createAppClients();

    await expect(readMember(clients)).rejects.toThrow("no-active-workspace");
    await createGroup(clients);

    expect(sentWorkspaces).toEqual([null]);
    expect(session.memberReads, "sending the action fetched the member again").toBe(1);
  });

  it("is absent after sign-out clears the tab's cache", async () => {
    const { sentWorkspaces } = stubApiRecordingActions();
    const clients = createAppClients();
    await readMember(clients);

    clients.queryClient.clear();
    await createGroup(clients);

    expect(sentWorkspaces).toEqual([null]);
  });

  it("is absent before the member has been read", async () => {
    const { sentWorkspaces } = stubApiRecordingActions();
    const clients = createAppClients();

    await createGroup(clients);

    expect(sentWorkspaces).toEqual([null]);
  });
});

describe("a tab whose reads arrive before its member read", () => {
  it("leaves when a later read comes from another workspace", async () => {
    const { session } = stubApiRecordingActions();
    const clients = createAppClients();
    const leaves = countWorkspaceLeaves(clients);

    await readGroups(clients);
    session.workspaceId = "v";
    await readGroups(clients);
    await readGroups(clients);

    expect(leaves.times).toBe(1);
  });

  it("leaves when the member read returns another workspace", async () => {
    const { session } = stubApiRecordingActions();
    const clients = createAppClients();
    const leaves = countWorkspaceLeaves(clients);

    await readGroups(clients);
    session.workspaceId = "v";
    await readMember(clients);

    expect(leaves.times).toBe(1);
  });

  it("stays when the member read returns the same workspace", async () => {
    stubApiRecordingActions();
    const clients = createAppClients();
    const leaves = countWorkspaceLeaves(clients);

    await readGroups(clients);
    await readMember(clients);

    expect(leaves.times).toBe(0);
  });

  it("stays when only the member read changes workspace", async () => {
    const { session } = stubApiRecordingActions();
    const clients = createAppClients();
    const leaves = countWorkspaceLeaves(clients);

    await readMember(clients);
    session.workspaceId = "v";
    await readMember(clients);

    expect(leaves.times).toBe(0);
  });
});

type SentAsk = {
  readonly method: string | undefined;
  readonly address: URL;
  readonly body: string;
  readonly workspace: string | null;
};

const stubApiRecordingAsks = () => {
  const sentAsks: SentAsk[] = [];
  vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
    const address = addressOf(input);
    if (!address.pathname.includes("ask.question")) {
      return answered([{ result: { data: { workspace: { id: "w" } } } }]);
    }
    sentAsks.push({
      method: init?.method,
      address,
      body: typeof init?.body === "string" ? init.body : "",
      workspace: new Headers(init?.headers).get(TAB_WORKSPACE_HEADER),
    });
    return Promise.resolve(new Response("", { status: 503 }));
  });
  return sentAsks;
};

const A_QUESTION = "How long are audit logs kept for buyers?";

describe("an ask request", () => {
  it("is a POST with the question only in its body", async () => {
    const sentAsks = stubApiRecordingAsks();
    const clients = createAppClients();
    await readMember(clients);

    await clients.apiClient.ask.question.mutate({ question: A_QUESTION }).catch(() => undefined);

    expect(sentAsks.map(({ method, workspace }) => [method, workspace])).toEqual([["POST", "w"]]);
    const [sent] = sentAsks;
    assert(sent !== undefined, "no ask request was sent");
    expect(sent.address.href).not.toMatch(/audit|logs|kept/i);
    expect(decodeURIComponent(sent.address.href)).not.toContain(A_QUESTION);
    expect(sent.body).toContain(A_QUESTION);
  });

  it("is not batched with a concurrent action", async () => {
    const sentAsks = stubApiRecordingAsks();
    const clients = createAppClients();

    await Promise.allSettled([
      clients.apiClient.ask.question.mutate({ question: A_QUESTION }),
      createGroup(clients),
    ]);

    expect(sentAsks.map(({ address }) => address.pathname)).toEqual([
      `${TRPC_ENDPOINT}/ask.question`,
    ]);
  });

  it("is not retried after the api fails it", async () => {
    const sentAsks = stubApiRecordingAsks();
    const clients = createAppClients();

    const failure = await clients.apiClient.ask.question.mutate({ question: A_QUESTION }).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(Error);
    expect(sentAsks).toHaveLength(1);
  });
});

describe("the tRPC endpoint", () => {
  it("matches the path apps/api mounts its router at", () => {
    const source = readFileSync(path.join(repositoryRoot, "apps/api/src/trpc/mount.ts"), "utf8");
    const declared = [...source.matchAll(/^export const TRPC_ENDPOINT = "(?<path>[^"]+)";$/gm)];

    expect(declared).toHaveLength(1);
    expect(declared[0]?.groups?.["path"]).toBe(TRPC_ENDPOINT);
  });
});

describe("modelChoices.list types from apps/api", () => {
  it("takes no input, since the session carries the workspace", () => {
    // `toEqualTypeOf` constrains its argument; a two-way conditional also fails a widened input.
    type NoInput = [inferInput<ListProcedure>] extends [void | undefined]
      ? [void | undefined] extends [inferInput<ListProcedure>]
        ? true
        : false
      : false;
    expectTypeOf<NoInput>().toEqualTypeOf<true>();
  });

  it("returns one model choice per purpose", () => {
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
