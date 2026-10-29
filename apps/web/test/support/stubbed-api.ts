import { act } from "@testing-library/react";
import { TRPCClientError } from "@trpc/client";
import { vi } from "vitest";

import { createAppClients } from "@/app/providers.tsx";
import type { Role } from "@/shared/navigation.ts";

export const carrying = (data: unknown): Error =>
  Object.assign(new TRPCClientError("refused"), { data });

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

export const answeringAs =
  (role: Role, operator = false) =>
  (input: string | URL | Request): Promise<Response> => {
    const { pathname } = addressOf(input);
    if (!pathname.startsWith("/trpc/")) return answered(A_SESSION);

    const known: Readonly<Record<string, unknown>> = {
      "session.member": {
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

export type Api = Map<string, () => unknown>;

export type Held = {
  readonly asked: Promise<void>;
  readonly pending: boolean;
  readonly asks: number;
  readonly resolve: (answer?: unknown) => void;
  readonly reject: (refusal: unknown) => void;
};

export const heldBack = (api: Api, procedure: string, answer?: unknown): Held => {
  const asked = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<() => unknown>();
  const before = api.get(procedure);
  let waiting = 0;
  let asks = 0;
  api.set(procedure, () => {
    asks += 1;
    waiting += 1;
    asked.resolve();
    return gate.promise.then((answering) => {
      waiting -= 1;
      return answering();
    });
  });
  return {
    asked: asked.promise,
    get pending() {
      return waiting > 0;
    },
    get asks() {
      return asks;
    },
    resolve: (given) => {
      gate.resolve(() => given ?? answer ?? before?.());
    },
    reject: (refusal) => {
      gate.resolve(() => refusal);
    },
  };
};

export const withTheApiDown = () => {
  vi.stubGlobal("fetch", () => Promise.reject(new TypeError("the network is down")));
  const clients = createAppClients();
  clients.queryClient.setDefaultOptions({ queries: { retry: false } });
  return clients;
};

const SETTLES_WITHIN_MS = 1000;

/** Drains the app's and the stub's timers in virtual time, so a check that nothing happened waits for the app. */
export const settlingAfter = async (happens: () => void): Promise<void> => {
  vi.useFakeTimers();
  try {
    await act(async () => {
      happens();
      await vi.advanceTimersByTimeAsync(SETTLES_WITHIN_MS);
    });
  } finally {
    vi.useRealTimers();
  }
};
