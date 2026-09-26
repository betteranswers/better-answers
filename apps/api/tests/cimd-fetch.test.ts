import { EventEmitter } from "node:events";
import type { IncomingHttpHeaders } from "node:http";
import type { RequestOptions } from "node:https";
import { Readable } from "node:stream";

import { describe, expect, it } from "vitest";

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

/** The fetcher sends every header as one string; Node's wider shapes are not its. */
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
  /** The body never ends, so only the fetcher's own `destroy` closes it. */
  holdOpen?: boolean;
  /** The request fails with this instead of answering. */
  failWith?: Error;
};

const inboundOf = (response: Canned) => {
  const stream = new Readable({ read() {} });
  stream.push(Buffer.from(response.body ?? ""));
  if (response.holdOpen !== true) stream.push(null);
  return Object.assign(stream, {
    statusCode: response.status,
    statusMessage: "OK",
    headers: response.headers ?? {},
  });
};

/** Like Node's `request`, it sends nothing until `end`. */
const observedAnswering = (
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
          const inbound = inboundOf(response);
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

const answering = (response: Canned): HttpsRequest => observedAnswering(response).request;

/** A resolver that answers only when the test says so. */
const heldLookups = (): { readonly lookup: Lookup; readonly settleOne: () => void } => {
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

describe("the transport's lookup answer", () => {
  it("answers an all-addresses lookup with an array, else one address", async () => {
    const { request, observed } = observedAnswering({ status: 200, body: "{}" });
    const fetcher = createClientMetadataFetcher({ lookup: resolvesTo(publicAnswer), request });

    const response = await fetcher("https://claude.ai/oauth/mcp-oauth-client-metadata");

    expect(response.status).toBe(200);
    expect(observed.lookupAnswers).toEqual([
      [{ address: "104.18.32.47", family: 4 }],
      ["104.18.32.47", 4],
    ]);
  });

  it("pins the address, keeping the hostname for Host and SNI", async () => {
    const { request, observed } = observedAnswering({ status: 200, body: "{}" });
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
    const { request, observed } = observedAnswering({ status: 200, body: "{}" });
    const fetcher = createClientMetadataFetcher({ lookup: resolvesTo(publicAnswer), request });

    await fetcher(url);

    expect(observed.servername).toBeUndefined();
  });

  it("hands the caller's signal to the request", async () => {
    const { request, observed } = observedAnswering({ status: 200, body: "{}" });
    const fetcher = createClientMetadataFetcher({ lookup: resolvesTo(publicAnswer), request });
    const caller = new AbortController();

    await fetcher("https://claude.ai/doc", { signal: caller.signal });

    expect(observed.signal).toBe(caller.signal);
  });
});

describe("the transport's reply", () => {
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
    ["a HEAD", "HEAD", 200],
    ["a 204", "GET", 204],
    ["a 304", "GET", 304],
  ])("carries no body for %s", async (_case, method, status) => {
    const fetcher = createClientMetadataFetcher({
      lookup: resolvesTo(publicAnswer),
      request: answering({ status, body: "ignored" }),
    });

    const response = await fetcher("https://claude.ai/doc", { method });

    expect(response.status).toBe(status);
    expect(response.body).toBeNull();
  });

  it("keeps every value of a repeated header, skipping absent ones", async () => {
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

  it("rejects with the request's own error", async () => {
    const failure = new Error("connect ECONNREFUSED");
    const fetcher = createClientMetadataFetcher({
      lookup: resolvesTo(publicAnswer),
      request: answering({ status: 200, failWith: failure }),
    });

    await expect(fetcher("https://claude.ai/doc")).rejects.toBe(failure);
  });
});

describe("the SSRF policy", () => {
  it("refuses anything but https", async () => {
    const fetcher = createClientMetadataFetcher({
      lookup: resolvesTo(publicAnswer),
      request: answering({ status: 200 }),
    });
    await expect(fetcher("http://claude.ai/oauth/mcp-oauth-client-metadata")).rejects.toThrow(
      "requires an HTTPS URL",
    );
  });

  it("refuses any method but GET and HEAD", async () => {
    const fetcher = createClientMetadataFetcher({
      lookup: resolvesTo(publicAnswer),
      request: answering({ status: 200 }),
    });
    await expect(fetcher("https://claude.ai/x", { method: "POST" })).rejects.toThrow(
      "only GET and HEAD",
    );
  });

  it.each([
    ["a loopback", "127.0.0.1"],
    ["a private (RFC 1918)", "10.0.0.5"],
    ["a private (RFC 1918)", "192.168.1.1"],
    ["a link-local (cloud metadata)", "169.254.169.254"],
    ["a CGNAT (shared space)", "100.64.0.1"],
    ["an IPv6 loopback", "::1"],
    ["an IPv6 unique local", "fd00::1"],
  ])("refuses %s answer (%s), sending nothing", async (_class, address) => {
    const { request, observed } = observedAnswering({ status: 200 });
    const fetcher = createClientMetadataFetcher({
      lookup: resolvesTo({ address, family: address.includes(":") ? 6 : 4 }),
      request,
    });

    await expect(fetcher("https://evil.example/doc")).rejects.toThrow("public-routable");
    expect(observed.requests).toBe(0);
  });

  it("refuses a private answer behind a public first one", async () => {
    const { request, observed } = observedAnswering({ status: 200 });
    const fetcher = createClientMetadataFetcher({
      lookup: resolvesTo(publicAnswer, { address: "10.0.0.5", family: 4 }),
      request,
    });

    await expect(fetcher("https://evil.example/doc")).rejects.toThrow("public-routable");
    expect(observed.requests).toBe(0);
  });

  it("refuses a hostname with no answers", async () => {
    const fetcher = createClientMetadataFetcher({
      lookup: resolvesTo(),
      request: answering({ status: 200 }),
    });
    await expect(fetcher("https://nowhere.example/doc")).rejects.toThrow("no DNS addresses");
  });

  it("returns a redirect unfollowed, never fetching a private location", async () => {
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

describe("the lift's guards", () => {
  it.each([600, 999])(
    "refuses status %i as a transport error, staying up",
    async (status) => {
      const { request, observed } = observedAnswering({ status, body: "{}", holdOpen: true });
      const fetcher = createClientMetadataFetcher({ lookup: resolvesTo(publicAnswer), request });

      const refused = fetcher("https://claude.ai/doc");

      await expect(refused).rejects.toThrow(
        new TypeError(`a Response cannot carry the metadata reply (status ${status})`),
      );
      await expect(refused).rejects.toMatchObject({ cause: expect.any(RangeError) });
      expect(observed.response?.destroyed).toBe(true);
    },
    2_000,
  );

  it("abandons a silent lookup when the signal aborts, sending nothing", async () => {
    const { request, observed } = observedAnswering({ status: 200 });
    const fetcher = createClientMetadataFetcher({ lookup: () => new Promise(() => {}), request });

    await expect(
      fetcher("https://claude.ai/doc", { signal: AbortSignal.timeout(20) }),
    ).rejects.toMatchObject({ name: "TimeoutError" });
    expect(observed.requests).toBe(0);
  }, 2_000);

  it("refuses a lookup when the signal has already aborted", async () => {
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

  it("counts an abandoned lookup against the bound until it settles", async () => {
    const { lookup, settleOne } = heldLookups();
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
