import http from "node:http";

/**
 * A fetch for the smoke test that HONOURS a `host` header.
 *
 * Inside the stack the app is reached on the loopback (`http://127.0.0.1:3000`), where the
 * hostname fence carries `/health` alone (T-030); every other path is asked for as the
 * app hostname, the way the tunnel would send it. Node's own `fetch` (undici) treats
 * `host` as a forbidden header and drops it silently, so the request would arrive as the
 * loopback and the fence would refuse it — which is exactly what a drill must not mistake
 * for a broken platform. `node:http` sends whatever headers it is given. `https:` URLs
 * are a public origin already carrying the right host, and go through `fetch` unchanged.
 */
export const fetchHonouringHost = (url: string, init?: RequestInit): Promise<Response> => {
  const target = new URL(url);
  if (target.protocol !== "http:") return fetch(url, init);
  const headers = Object.fromEntries(new Headers(init?.headers));
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: target.hostname,
        port: target.port === "" ? 80 : Number(target.port),
        path: `${target.pathname}${target.search}`,
        method: init?.method ?? "GET",
        headers,
      },
      (incoming) => {
        const chunks: Buffer[] = [];
        incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
        incoming.on("end", () => {
          const status = incoming.statusCode ?? 0;
          const responseHeaders = new Headers();
          for (const [name, value] of Object.entries(incoming.headers)) {
            if (typeof value === "string") responseHeaders.set(name, value);
            else if (Array.isArray(value)) responseHeaders.set(name, value.join(", "));
          }
          // A body on a null-body status is a construction error, not a response.
          const body =
            status === 204 || status === 205 || status === 304 ? null : Buffer.concat(chunks);
          resolve(new Response(body, { status, headers: responseHeaders }));
        });
        incoming.on("error", reject);
      },
    );
    request.on("error", reject);
    request.end();
  });
};
