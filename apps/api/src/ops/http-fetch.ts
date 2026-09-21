import http from "node:http";

// Undici drops a `host` header silently, so the smoke test's request would arrive as the
// loopback and the hostname fence would refuse it.
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
