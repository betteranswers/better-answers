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
import { memberOptions } from "@/shared/member.ts";

import { addressOf, answered } from "./stubbed-api.ts";

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

/** An api whose member read answers the workspace `session.in`; `named` is what each group made named. */
const anApiHearingActions = () => {
  const named: (string | null)[] = [];
  const session = { in: "w" };
  vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
    const { pathname } = addressOf(input);
    if (pathname.endsWith("/members.createGroup")) {
      named.push(new Headers(init?.headers).get(TAB_WORKSPACE_HEADER));
    }
    const member = {
      workspace: { id: session.in, name: "Northern Tooling" },
      person: { id: "p", name: "Ada", email: "ada@example.test" },
      role: "Admin",
    };
    return answered([{ result: { data: pathname.endsWith("/session.member") ? member : null } }]);
  });
  return { named, session };
};

const memberRead = (clients: AppClients) =>
  clients.queryClient.fetchQuery(
    memberOptions(createApiProxy(clients.apiClient, clients.queryClient)),
  );

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

  it("is none while the tab holds no member read", async () => {
    const { named } = anApiHearingActions();
    const clients = createAppClients();

    await groupMade(clients);

    expect(named).toEqual([null]);
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
