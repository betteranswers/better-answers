import { readFileSync } from "node:fs";
import path from "node:path";

import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import type { inferInput, inferOutput } from "@trpc/tanstack-react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, expectTypeOf, it } from "vitest";

import { Providers } from "@/app/providers.tsx";
import { createAppRouter } from "@/app/router.tsx";
import { TRPC_ENDPOINT, useTRPC } from "@/shared/api/trpc.ts";

/**
 * The SPA's one typed client, through the seam a screen crosses: the options proxy a
 * component reads out of React context, in the tree `main.tsx` composes.
 *
 * Nothing here talks to a server. What the api answers is the api suite's and the browser
 * suite's; what this file holds is that the client exists, that the provider is above the
 * router, and that `routes.list`'s input and output arrive in the browser with no generated
 * file between the two workspaces (ADR 0006, amended 2026-09-02).
 */

afterEach(cleanup);

type ListProcedure = ReturnType<typeof useTRPC>["routes"]["list"];

/** A stand-in for the screen T-038 builds: it reads the api client the way that screen will. */
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

    expect(JSON.parse(screen.getByTestId("probe").textContent ?? "null")).toEqual([
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

    // The composition `main.tsx` mounts: the provider outside, the router and every screen
    // it renders inside. A provider below the router could not wrap this tree.
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
    // The SPA cannot import `TRPC_ENDPOINT`: a value import from the api is the runtime edge
    // ADR 0006's amendment refuses. So the constant's source file is read instead, and more
    // than one declaration is a failure — the shape `[DEPS2]` sets out and
    // `apps/worker/tests/pg_harness.py` already uses for `POSTGRES_IMAGE`. A mount moved
    // without moving the client fails here rather than in a browser.
    const source = readFileSync(
      path.join(import.meta.dirname, "../../api/src/trpc/router.ts"),
      "utf8",
    );
    const declared = [...source.matchAll(/^export const TRPC_ENDPOINT = "(?<path>[^"]+)";$/gm)];

    expect(declared).toHaveLength(1);
    expect(declared[0]?.groups?.["path"]).toBe(TRPC_ENDPOINT);
  });
});

describe("routes.list's types crossing from apps/api", () => {
  it("takes no input, because the workspace is the session's and never an argument", () => {
    // Read through a conditional rather than asserted directly: `toEqualTypeOf` constrains
    // its argument to `{}`, and the whole point of this assertion is that the input is
    // absent. It is written both ways round, so it fails on a widened input as well as a
    // narrowed one: a `workspaceId` argument appearing on the procedure fails this line.
    type NoInput = [inferInput<ListProcedure>] extends [void | undefined]
      ? [void | undefined] extends [inferInput<ListProcedure>]
        ? true
        : false
      : false;
    expectTypeOf<NoInput>().toEqualTypeOf<true>();
  });

  it("answers one route per purpose, with the words a screen shows", () => {
    type Route = inferOutput<ListProcedure>[number];

    expectTypeOf<Route["purpose"]>().toEqualTypeOf<
      "extraction" | "enrichment" | "answering" | "judging" | "embedding"
    >();
    expectTypeOf<Route["provider"]>().toEqualTypeOf<string | null>();
    expectTypeOf<Route["model"]>().toEqualTypeOf<string | null>();
    expectTypeOf<Route["dimensions"]>().toEqualTypeOf<number | null>();
    expectTypeOf<Route["fixed"]>().toEqualTypeOf<boolean>();
  });
});
