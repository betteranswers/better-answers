import { EventEmitter } from "node:events";
import type { IncomingHttpHeaders } from "node:http";
import type { RequestOptions } from "node:https";
import { Readable } from "node:stream";

import { getRequestListener } from "@hono/node-server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { matching } from "@better-answers/schema/testing/matching";

import {
  createClientMetadataFetcher,
  type HttpsRequest,
  type LookedUpAddress,
  type Lookup,
} from "../lifts/better-auth-cimd-node/index.ts";

type Observed = {
  lookupAnswers: unknown[];
  headers: Readonly<Record<string, string>>;
  servername: string | undefined;
  agent: RequestOptions["agent"];
  signal: AbortSignal | undefined;
  requests: number;
  response: Readable | undefined;
};

const publicAnswer: LookedUpAddress = { address: "104.18.32.47", family: 4 };
const resolvesTo =
  (...answers: LookedUpAddress[]): Lookup =>
  async () =>
    answers;

const stringHeadersOf = (headers: RequestOptions["headers"]): Readonly<Record<string, string>> =>
  Object.fromEntries(
    Object.entries(headers ?? {}).flatMap(([name, value]) =>
      typeof value === "string" ? [[name, value]] : [],
    ),
  );

type Canned = {
  status: number;
  body?: string | Buffer;
  headers?: IncomingHttpHeaders;
  holdOpen?: boolean;
  failWith?: Error;
};

const responseStreamOf = (response: Canned) => {
  const stream = new Readable({ read() {} });
  stream.push(Buffer.from(response.body ?? ""));
  if (response.holdOpen !== true) stream.push(null);
  return Object.assign(stream, {
    statusCode: response.status,
    statusMessage: "OK",
    headers: response.headers ?? {},
  });
};

/** Like Node's `request`, the fake sends nothing until `end` is called. */
const recordingRequest = (
  response: Canned,
): { readonly request: HttpsRequest; readonly observed: Observed } => {
  const observed: Observed = {
    lookupAnswers: [],
    headers: {},
    servername: undefined,
    agent: undefined,
    signal: undefined,
    requests: 0,
    response: undefined,
  };
  const answer: HttpsRequest = (_url, options, callback) => {
    observed.requests += 1;
    observed.headers = stringHeadersOf(options.headers);
    observed.servername = options.servername;
    observed.agent = options.agent;
    observed.signal = options.signal;
    const { lookup } = options;

    lookup?.("ignored", { all: true }, (_error, address) => observed.lookupAnswers.push(address));
    lookup?.("ignored", {}, (_error, address, family) =>
      observed.lookupAnswers.push([address, family]),
    );

    const outbound = Object.assign(new EventEmitter(), {
      end(): void {
        queueMicrotask(() => {
          if (response.failWith !== undefined) {
            outbound.emit("error", response.failWith);
            return;
          }
          const inbound = responseStreamOf(response);
          observed.response = inbound;
          callback(inbound);
        });
      },
      destroy(): void {},
    });
    return outbound;
  };
  return { request: answer, observed };
};

const answering = (response: Canned): HttpsRequest => recordingRequest(response).request;

const pausedLookups = (): { readonly lookup: Lookup; readonly settleOne: () => void } => {
  const held: Array<() => void> = [];
  return {
    lookup: () =>
      new Promise((resolve) => {
        held.push(() => resolve([publicAnswer]));
      }),
    settleOne: () => held.shift()?.(),
  };
};

const settled = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe("the request the metadata fetcher sends", () => {
  it("answers an all-addresses lookup with every address, otherwise one", async () => {
    const { request, observed } = recordingRequest({ status: 200, body: "{}" });
    const fetcher = createClientMetadataFetcher({ lookup: resolvesTo(publicAnswer), request });

    const response = await fetcher("https://claude.ai/oauth/mcp-oauth-client-metadata");

    expect(response.status).toBe(200);
    expect(observed.lookupAnswers).toEqual([
      [{ address: "104.18.32.47", family: 4 }],
      ["104.18.32.47", 4],
    ]);
  });

  it("uses the hostname for Host and SNI, without an agent", async () => {
    const { request, observed } = recordingRequest({ status: 200, body: "{}" });
    const fetcher = createClientMetadataFetcher({ lookup: resolvesTo(publicAnswer), request });

    await fetcher("https://claude.ai/oauth/mcp-oauth-client-metadata");

    expect(observed.headers["host"]).toBe("claude.ai");
    expect(observed.servername).toBe("claude.ai");
    expect(observed.agent).toBe(false);
  });

  it.each([
    ["an IPv4", "https://104.18.32.47/doc"],
    ["a bracketed IPv6", "https://[2606:4700::6812:202f]/doc"],
  ])("sends no SNI for %s literal", async (_kind, url) => {
    const { request, observed } = recordingRequest({ status: 200, body: "{}" });
    const fetcher = createClientMetadataFetcher({ lookup: resolvesTo(publicAnswer), request });

    await fetcher(url);

    expect(observed.servername).toBeUndefined();
  });

  it("passes the caller's abort signal to the request", async () => {
    const { request, observed } = recordingRequest({ status: 200, body: "{}" });
    const fetcher = createClientMetadataFetcher({ lookup: resolvesTo(publicAnswer), request });
    const caller = new AbortController();

    await fetcher("https://claude.ai/doc", { signal: caller.signal });

    expect(observed.signal).toBe(caller.signal);
  });
});

describe("the response the metadata fetcher returns", () => {
  it("reads the status text and body of a GET", async () => {
    const fetcher = createClientMetadataFetcher({
      lookup: resolvesTo(publicAnswer),
      request: answering({ status: 200, body: '{"client_id":"x"}' }),
    });

    const response = await fetcher("https://claude.ai/doc");

    expect(response.statusText).toBe("OK");
    expect(await response.text()).toBe('{"client_id":"x"}');
  });

  it.each([
    ["a HEAD request", "HEAD", 200],
    ["a 204 response", "GET", 204],
    ["a 304 response", "GET", 304],
  ])("returns no body for %s", async (_case, method, status) => {
    const fetcher = createClientMetadataFetcher({
      lookup: resolvesTo(publicAnswer),
      request: answering({ status, body: "ignored" }),
    });

    const response = await fetcher("https://claude.ai/doc", { method });

    expect(response.status).toBe(status);
    expect(response.body).toBeNull();
  });

  it("keeps each repeated header value and drops undefined headers", async () => {
    const fetcher = createClientMetadataFetcher({
      lookup: resolvesTo(publicAnswer),
      request: answering({
        status: 200,
        headers: { "set-cookie": ["a=1", "b=2"], etag: undefined, "cache-control": "max-age=60" },
      }),
    });

    const response = await fetcher("https://claude.ai/doc");

    expect(response.headers.getSetCookie()).toEqual(["a=1", "b=2"]);
    expect(response.headers.has("etag")).toBe(false);
    expect(response.headers.get("cache-control")).toBe("max-age=60");
  });

  it("rejects with the error the request emitted", async () => {
    const failure = new Error("connect ECONNREFUSED");
    const fetcher = createClientMetadataFetcher({
      lookup: resolvesTo(publicAnswer),
      request: answering({ status: 200, failWith: failure }),
    });

    await expect(fetcher("https://claude.ai/doc")).rejects.toBe(failure);
  });
});

describe("the SSRF policy", () => {
  it("rejects a URL that is not HTTPS", async () => {
    const fetcher = createClientMetadataFetcher({
      lookup: resolvesTo(publicAnswer),
      request: answering({ status: 200 }),
    });
    await expect(fetcher("http://claude.ai/oauth/mcp-oauth-client-metadata")).rejects.toThrow(
      "requires an HTTPS URL",
    );
  });

  it("rejects any method other than GET and HEAD", async () => {
    const fetcher = createClientMetadataFetcher({
      lookup: resolvesTo(publicAnswer),
      request: answering({ status: 200 }),
    });
    await expect(fetcher("https://claude.ai/x", { method: "POST" })).rejects.toThrow(
      "only GET and HEAD",
    );
  });

  it.each([
    ["a loopback", "127.0.0.1", 4],
    ["a private (RFC 1918)", "10.0.0.5", 4],
    ["a private (RFC 1918)", "192.168.1.1", 4],
    ["a link-local (cloud metadata)", "169.254.169.254", 4],
    ["a CGNAT (shared space)", "100.64.0.1", 4],
    ["an IPv6 loopback", "::1", 6],
    ["an IPv6 unique local", "fd00::1", 6],
  ] as const)("rejects %s address (%s) before any request", async (_class, address, family) => {
    const { request, observed } = recordingRequest({ status: 200 });
    const fetcher = createClientMetadataFetcher({
      lookup: resolvesTo({ address, family }),
      request,
    });

    await expect(fetcher("https://evil.example/doc")).rejects.toThrow("public-routable");
    expect(observed.requests).toBe(0);
  });

  it("rejects a private address listed after a public one", async () => {
    const { request, observed } = recordingRequest({ status: 200 });
    const fetcher = createClientMetadataFetcher({
      lookup: resolvesTo(publicAnswer, { address: "10.0.0.5", family: 4 }),
      request,
    });

    await expect(fetcher("https://evil.example/doc")).rejects.toThrow("public-routable");
    expect(observed.requests).toBe(0);
  });

  it("rejects a hostname with no DNS addresses", async () => {
    const fetcher = createClientMetadataFetcher({
      lookup: resolvesTo(),
      request: answering({ status: 200 }),
    });
    await expect(fetcher("https://nowhere.example/doc")).rejects.toThrow("no DNS addresses");
  });

  it("returns a redirect to a private address without following it", async () => {
    let lookups = 0;
    const fetcher = createClientMetadataFetcher({
      lookup: async () => {
        lookups += 1;
        return [publicAnswer];
      },
      request: answering({
        status: 302,
        headers: { location: "https://169.254.169.254/latest/meta-data" },
      }),
    });

    const response = await fetcher("https://claude.ai/doc");

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://169.254.169.254/latest/meta-data");
    expect(lookups).toBe(1);
  });
});

describe("the fetcher's safeguards", () => {
  const native = {
    Request: Object.getOwnPropertyDescriptor(globalThis, "Request"),
    Response: Object.getOwnPropertyDescriptor(globalThis, "Response"),
  };

  describe.each([
    ["Node's built-in global Response", () => {}],
    [
      "the global Response that @hono/node-server's serve() installs",
      () => void getRequestListener(() => new Response()),
    ],
  ])("under %s", (_globals, install) => {
    beforeEach(install);

    afterEach(() => {
      for (const [name, descriptor] of Object.entries(native)) {
        if (descriptor !== undefined) Object.defineProperty(globalThis, name, descriptor);
      }
    });

    it.each([600, 999])(
      "rejects status %i as a TypeError and destroys the response",
      async (status) => {
        const { request, observed } = recordingRequest({ status, body: "{}", holdOpen: true });
        const fetcher = createClientMetadataFetcher({ lookup: resolvesTo(publicAnswer), request });

        const refused = fetcher("https://claude.ai/doc");

        await expect(refused).rejects.toThrow(
          new TypeError(`a Response cannot carry the metadata reply (status ${status})`),
        );
        await expect(refused).rejects.toMatchObject({ cause: matching.any(RangeError) });
        expect(observed.response?.destroyed).toBe(true);
      },
      2_000,
    );
  });

  it("times out a hung lookup and sends no request", async () => {
    const { request, observed } = recordingRequest({ status: 200 });
    const fetcher = createClientMetadataFetcher({ lookup: () => new Promise(() => {}), request });

    await expect(
      fetcher("https://claude.ai/doc", { signal: AbortSignal.timeout(20) }),
    ).rejects.toMatchObject({ name: "TimeoutError" });
    expect(observed.requests).toBe(0);
  }, 2_000);

  it("skips the lookup when the signal has already aborted", async () => {
    let lookups = 0;
    const fetcher = createClientMetadataFetcher({
      lookup: async () => {
        lookups += 1;
        return [publicAnswer];
      },
      request: answering({ status: 200 }),
    });

    await expect(
      fetcher("https://claude.ai/doc", { signal: AbortSignal.abort() }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(lookups).toBe(0);
  });

  it("counts an aborted lookup toward the 32-lookup limit until resolved", async () => {
    const { lookup, settleOne } = pausedLookups();
    let lookups = 0;
    const fetcher = createClientMetadataFetcher({
      lookup: (hostname) => {
        lookups += 1;
        return lookup(hostname);
      },
      request: answering({ status: 200, body: "{}" }),
    });
    const abandoned = async (n: number) => {
      const caller = new AbortController();
      const fetching = fetcher(`https://host-${n}.example/doc`, { signal: caller.signal });
      caller.abort();
      await expect(fetching).rejects.toMatchObject({ name: "AbortError" });
    };

    for (let n = 0; n < 32; n += 1) await abandoned(n);
    await expect(fetcher("https://host-32.example/doc")).rejects.toThrow("too many");
    expect(lookups).toBe(32);

    settleOne();
    await settled();
    await abandoned(33);
    expect(lookups).toBe(33);
  }, 5_000);
});
