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
