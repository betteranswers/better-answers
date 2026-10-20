import { readFileSync } from "node:fs";
import path from "node:path";

import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import type { inferInput, inferOutput } from "@trpc/tanstack-react-query";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import { TAB_WORKSPACE_HEADER } from "@better-answers/schema/tab-workspace";

import { createAppClients, Providers, type AppClients } from "@/app/providers.tsx";
import { createAppRouter } from "@/app/router.tsx";
import { createApiProxy, TRPC_ENDPOINT, useTRPC } from "@/shared/api/trpc.ts";
import { memberOptions, NEEDS_A_PICK } from "@/shared/member.ts";

import { addressOf, answered } from "./stubbed-api.ts";
import { aRefusalAnswer } from "./two-workspaces.ts";

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

type Session = {
  in: string | undefined;
  memberReads: number;
  failing: boolean;
  answered: Promise<void>;
};

const anApiHearingActions = () => {
  const named: (string | null)[] = [];
  const session: Session = {
    in: "w",
    memberReads: 0,
    failing: false,
    answered: Promise.resolve(),
  };
  vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
    const { pathname } = addressOf(input);
    if (pathname.endsWith("/members.createGroup")) {
      named.push(new Headers(init?.headers).get(TAB_WORKSPACE_HEADER));
    }
    if (!pathname.endsWith("/session.member")) return answered([{ result: { data: null } }]);
    session.memberReads += 1;
    if (session.failing) return Promise.resolve(new Response("", { status: 503 }));
    if (session.in === undefined) {
      return answered([aRefusalAnswer(NEEDS_A_PICK, "unauthenticated", 401)]);
    }
    const member = {
      workspace: { id: session.in, name: "Northern Tooling" },
      person: { id: "p", name: "Ada", email: "ada@example.test" },
      role: "Admin",
    };
    return session.answered.then(() => answered([{ result: { data: member } }]));
  });
  return { named, session };
};

const memberRead = (clients: AppClients) =>
  clients.queryClient.fetchQuery(
    memberOptions(createApiProxy(clients.apiClient, clients.queryClient)),
  );

const memberKeyOf = (clients: AppClients) =>
  memberOptions(createApiProxy(clients.apiClient, clients.queryClient)).queryKey;

/** tRPC sends a batch on a later task, so two tasks on, an action not held back has been sent. */
const batchesSent = async () => {
  for (const _ of [1, 2]) await new Promise((resolve) => setTimeout(resolve, 0));
};

const groupMade = (clients: AppClients) =>
  clients.apiClient.members.createGroup.mutate({ name: "Bid writers" });

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

  it("is none, reading nothing, once the member read is refused", async () => {
    const { named, session } = anApiHearingActions();
    session.in = undefined;
    const clients = createAppClients();

    await expect(memberRead(clients)).rejects.toThrow("no-active-workspace");
    await groupMade(clients);

    expect(named).toEqual([null]);
    expect(session.memberReads, "the action read the member again").toBe(1);
  });

  it("waits for a member read the tab has asked", async () => {
    const { named, session } = anApiHearingActions();
    const read = Promise.withResolvers<void>();
    session.answered = read.promise;
    const clients = createAppClients();

    const asked = memberRead(clients);
    const made = groupMade(clients);
    await batchesSent();
    read.resolve();
    await Promise.all([asked, made]);

    expect(named).toEqual(["w"]);
  });

  it("is none once a failed member read fails again", async () => {
    const { named, session } = anApiHearingActions();
    session.failing = true;
    const clients = createAppClients();
    clients.queryClient.setQueryDefaults(memberKeyOf(clients), { retryDelay: 0 });
    await expect(memberRead(clients)).rejects.toBeInstanceOf(Error);

    await groupMade(clients);

    expect(named).toEqual([null]);
    expect(session.memberReads, "the action read no member").toBeGreaterThan(1);
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
    expect(sent?.address.href).not.toMatch(/audit|logs|kept/i);
    expect(decodeURIComponent(sent?.address.href ?? "")).not.toContain(A_QUESTION);
    expect(sent?.body).toContain(A_QUESTION);
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
    const source = readFileSync(
      path.join(import.meta.dirname, "../../api/src/trpc/mount.ts"),
      "utf8",
    );
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
