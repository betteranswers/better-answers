import { readFileSync } from "node:fs";
import path from "node:path";

import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import type { inferInput, inferOutput } from "@trpc/tanstack-react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, expectTypeOf, it } from "vitest";

import { Providers } from "@/app/providers.tsx";
import { createAppRouter } from "@/app/router.tsx";
import { TRPC_ENDPOINT, useTRPC } from "@/shared/api/trpc.ts";

afterEach(cleanup);

type ListProcedure = ReturnType<typeof useTRPC>["routes"]["list"];

function RoutesProbe() {
  const api = useTRPC();
  const options = api.routes.list.queryOptions();
  return <p data-testid="probe">{JSON.stringify(options.queryKey)}</p>;
}

describe("the SPA's tRPC client", () => {
  it("hands a component the query options for a workspace's routes, named by the procedure", () => {
    render(
      <Providers>
        <RoutesProbe />
      </Providers>,
    );

    expect(JSON.parse(screen.getByTestId("probe").textContent)).toEqual([
      ["routes", "list"],
      { type: "query" },
    ]);
  });

  it("is reachable only through the provider, so no screen can hold a client of its own", () => {
    expect(() => render(<RoutesProbe />)).toThrow(/TRPCProvider/);
  });
});

describe("the query provider above the router", () => {
  it("wraps the router, so a screen the router renders reaches the same client", async () => {
    const router = createAppRouter(createMemoryHistory({ initialEntries: ["/system"] }));
    await router.load();

    render(
      <Providers>
        <RouterProvider router={router} />
        <RoutesProbe />
      </Providers>,
    );

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("System");
    expect(screen.getByTestId("probe").textContent).toContain("routes");
  });
});

describe("the path the client and the api agree on", () => {
  it("is the path apps/api mounts its router at, and there is only one of it", () => {
    const source = readFileSync(
      path.join(import.meta.dirname, "../../api/src/trpc/mount.ts"),
      "utf8",
    );
    const declared = [...source.matchAll(/^export const TRPC_ENDPOINT = "(?<path>[^"]+)";$/gm)];

    expect(declared).toHaveLength(1);
    expect(declared[0]?.groups?.["path"]).toBe(TRPC_ENDPOINT);
  });
});

describe("routes.list's types crossing from apps/api", () => {
  it("takes no input, because the workspace is the session's and never an argument", () => {
    type NoInput = [inferInput<ListProcedure>] extends [void | undefined]
      ? [void | undefined] extends [inferInput<ListProcedure>]
        ? true
        : false
      : false;
    expectTypeOf<NoInput>().toEqualTypeOf<true>();
  });

  it("answers one route per purpose, with the words a screen shows", () => {
    type Route = inferOutput<ListProcedure>[number];

    type ExpectedRoute = {
      readonly purpose: "extraction" | "enrichment" | "answering" | "judging" | "embedding";
      readonly provider: string | null;
      readonly model: string | null;
      readonly dimensions: number | null;
      readonly fixed: boolean;
      readonly retentionTail: string | null;
    };

    expectTypeOf<Route>().toEqualTypeOf<ExpectedRoute>();
  });
});
