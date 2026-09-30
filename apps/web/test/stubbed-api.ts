import { TRPCClientError } from "@trpc/client";
import { vi } from "vitest";

import { createAppClients } from "@/app/providers.tsx";
import type { Role } from "@/shared/navigation.ts";

/** A failed call as the client hands it over, with whatever `data` the api's formatter sent. */
export const carrying = (data: unknown): Error =>
  Object.assign(new TRPCClientError("refused"), { data });

/** The address a stubbed `fetch` was asked for, whichever of its three shapes the caller used. */
export const addressOf = (input: string | URL | Request): URL =>
  new URL(
    typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    "http://app.test",
  );

export const answered = (body: unknown): Promise<Response> =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );

const A_SESSION = { session: { activeOrganizationId: "w" }, user: { id: "p", name: "Ada" } };

/** A refusal is never asked again, so no retry outlives the test onto the next stub. */
const REFUSED = {
  error: {
    message: "forbidden",
    code: -32_003,
    data: {
      code: "FORBIDDEN",
      httpStatus: 403,
      refusal: { word: "forbidden", class: "forbidden" },
    },
  },
};

/**
 * Ada, a member of Northern Tooling at `role`. Every other read is refused, so a screen draws
 * its own state and never another test's data.
 */
export const answeringAs =
  (role: Role, operator = false) =>
  (input: string | URL | Request): Promise<Response> => {
    const { pathname } = addressOf(input);
    if (!pathname.startsWith("/trpc/")) return answered(A_SESSION);

    const known: Readonly<Record<string, unknown>> = {
      "session.membership": {
        workspace: { id: "w", name: "Northern Tooling" },
        person: { id: "p", name: "Ada", email: "ada@example.test" },
        role,
      },
      "session.operator": { operator, name: "Ada" },
    };
    const names = pathname.replace("/trpc/", "").split(",");
    return answered(
      names.map((name) => (name in known ? { result: { data: known[name] } } : REFUSED)),
    );
  };

/** No role held: the membership read fails, and is not retried onto the next test's stub. */
export const withTheApiDown = () => {
  vi.stubGlobal("fetch", () => Promise.reject(new TypeError("the network is down")));
  const clients = createAppClients();
  clients.queryClient.setDefaultOptions({ queries: { retry: false } });
  return clients;
};
