import { TRPCClientError } from "@trpc/client";

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
