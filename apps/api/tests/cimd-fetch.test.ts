import { EventEmitter } from "node:events";
import type { IncomingHttpHeaders } from "node:http";
import type { RequestOptions } from "node:https";
import { Readable } from "node:stream";

import { describe, expect, it } from "vitest";

import {
  CimdTransportError,
  createClientMetadataFetcher,
  type HttpsRequest,
  type LookedUpAddress,
  type Lookup,
} from "../lifts/better-auth-cimd-node/index.ts";

type Observed = {
  lookupAnswers: unknown[];
  headers: Readonly<Record<string, string>>;
  servername: string | undefined;
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
  delayMs?: number;
};

const observedAnswering = (
  response: Canned,
): { readonly request: HttpsRequest; readonly observed: Observed } => {
  const observed: Observed = { lookupAnswers: [], headers: {}, servername: undefined };
  const answer: HttpsRequest = (_url, options, callback) => {
    observed.headers = stringHeadersOf(options.headers);
    observed.servername = options.servername;
    const { lookup } = options;

    lookup?.("ignored", { all: true }, (_error, address) => observed.lookupAnswers.push(address));
    lookup?.("ignored", {}, (_error, address, family) =>
      observed.lookupAnswers.push([address, family]),
    );

    const request = Object.assign(new EventEmitter(), {
      end(): void {},
      destroy(): void {},
    });
    const deliver = () => {
      callback(
        Object.assign(Readable.from([Buffer.from(response.body ?? "")]), {
          statusCode: response.status,
          statusMessage: "OK",
          headers: response.headers ?? {},
        }),
      );
    };
    if (response.delayMs === undefined) queueMicrotask(deliver);
    else {
      const timer = setTimeout(deliver, response.delayMs);
      options.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        const abort = new Error("aborted");
        abort.name = "AbortError";
        request.emit("error", abort);
      });
    }
    return request;
  };
  return { request: answer, observed };
};

const answering = (response: Canned): HttpsRequest => observedAnswering(response).request;

const neverResolving = (
  timeoutMs: number,
): {
  readonly fetcher: ReturnType<typeof createClientMetadataFetcher>;
  readonly requests: () => number;
} => {
  let requested = 0;
  return {
    fetcher: createClientMetadataFetcher({
      lookup: () => new Promise(() => {}),
      request: () => {
        requested += 1;
        throw new Error("never");
      },
      timeoutMs,
    }),
    requests: () => requested,
  };
};

describe("the CIMD transport's fix", () => {
  it("answers an all-addresses lookup with an array, else one address", async () => {
    const { request, observed } = observedAnswering({ status: 200, body: "{}" });
    const fetcher = createClientMetadataFetcher({
      lookup: resolvesTo(publicAnswer),
      request,
    });

    const response = await fetcher("https://claude.ai/oauth/mcp-oauth-client-metadata");

    expect(response.status).toBe(200);
    expect(observed.lookupAnswers).toEqual([
      [{ address: "104.18.32.47", family: 4 }],
      ["104.18.32.47", 4],
    ]);
  });

  it("pins the address, keeping the hostname for Host and SNI", async () => {
    const { request, observed } = observedAnswering({ status: 200, body: "{}" });
    const fetcher = createClientMetadataFetcher({
      lookup: resolvesTo(publicAnswer),
      request,
    });

    await fetcher("https://claude.ai/oauth/mcp-oauth-client-metadata");

    expect(observed.headers["host"]).toBe("claude.ai");
    expect(observed.servername).toBe("claude.ai");
  });
});

describe("the SSRF policy", () => {
  const refusal = async (
    fetcher: ReturnType<typeof createClientMetadataFetcher>,
    url: string,
    init?: RequestInit,
  ) => {
    try {
      await fetcher(url, init);
    } catch (error) {
      return error instanceof CimdTransportError ? error.reason : String(error);
    }
    return "fetched";
  };

  it("refuses anything but https", async () => {
    const fetcher = createClientMetadataFetcher({
      lookup: resolvesTo(publicAnswer),
      request: answering({ status: 200 }),
    });
    expect(await refusal(fetcher, "http://claude.ai/oauth/mcp-oauth-client-metadata")).toBe(
      "not-https",
    );
  });

  it("refuses any method but GET and HEAD", async () => {
    const fetcher = createClientMetadataFetcher({
      lookup: resolvesTo(publicAnswer),
      request: answering({ status: 200 }),
    });
    expect(await refusal(fetcher, "https://claude.ai/x", { method: "POST" })).toBe(
      "method-not-allowed",
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

    expect(await refusal(fetcher, "https://evil.example/doc")).toBe("address-not-public");
    expect(observed.lookupAnswers).toEqual([]);
  });

  it("refuses a private answer behind a public first one", async () => {
    const fetcher = createClientMetadataFetcher({
      lookup: resolvesTo(publicAnswer, { address: "10.0.0.5", family: 4 }),
      request: answering({ status: 200 }),
    });
    expect(await refusal(fetcher, "https://evil.example/doc")).toBe("address-not-public");
  });

  it("refuses a hostname with no answers", async () => {
    const fetcher = createClientMetadataFetcher({
      lookup: resolvesTo(),
      request: answering({ status: 200 }),
    });
    expect(await refusal(fetcher, "https://nowhere.example/doc")).toBe("no-addresses");
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

  it("refuses a response past the cap while streaming it", async () => {
    const fetcher = createClientMetadataFetcher({
      lookup: resolvesTo(publicAnswer),
      request: answering({ status: 200, body: Buffer.alloc(70 * 1024, "a") }),
      maxBodyBytes: 64 * 1024,
    });

    const response = await fetcher("https://claude.ai/doc");

    await expect(response.text()).rejects.toMatchObject({ reason: "response-too-large" });
  });

  it("refuses a fetch that outlives the timeout", async () => {
    const fetcher = createClientMetadataFetcher({
      lookup: resolvesTo(publicAnswer),
      request: answering({ status: 200, delayMs: 200 }),
      timeoutMs: 20,
    });

    expect(await refusal(fetcher, "https://claude.ai/doc")).toBe("timeout");
  });

  it("refuses a status outside the range a Response can carry", async () => {
    const fetcher = createClientMetadataFetcher({
      lookup: resolvesTo(publicAnswer),
      request: answering({ status: 600 }),
    });

    expect(await refusal(fetcher, "https://claude.ai/doc")).toBe("bad-status");
  });

  it("refuses a silent resolver under the same deadline, sending nothing", async () => {
    const { fetcher, requests } = neverResolving(20);

    expect(await refusal(fetcher, "https://claude.ai/doc")).toBe("timeout");
    expect(requests()).toBe(0);
  });

  it("bounds lookups in flight, counting ones the caller abandoned", async () => {
    const { fetcher, requests } = neverResolving(10);

    for (let n = 0; n < 32; n += 1) {
      expect(await refusal(fetcher, `https://host-${n}.example/doc`)).toBe("timeout");
    }
    const started = Date.now();
    expect(await refusal(fetcher, "https://host-33.example/doc")).toBe("too-many-lookups");
    expect(Date.now() - started).toBeLessThan(10);
    expect(requests()).toBe(0);
  });

  it("bounds the host cache, re-resolving the oldest past the cap", async () => {
    const lookups = new Map<string, number>();
    const fetcher = createClientMetadataFetcher({
      lookup: async (hostname) => {
        lookups.set(hostname, (lookups.get(hostname) ?? 0) + 1);
        return [publicAnswer];
      },
      request: answering({ status: 200, body: "{}" }),
      hostCacheMs: 60_000,
    });

    await fetcher("https://first.example/doc");
    for (let n = 0; n < 1024; n += 1) await fetcher(`https://host-${n}.example/doc`);
    await fetcher("https://first.example/doc");

    expect(lookups.get("first.example")).toBe(2);
  });

  it("reuses a host's pinned answer until the cache window ends", async () => {
    let lookups = 0;
    let clock = 0;
    const fetcher = createClientMetadataFetcher({
      lookup: async () => {
        lookups += 1;
        return [publicAnswer];
      },
      request: answering({ status: 200, body: "{}" }),
      hostCacheMs: 1_000,
      now: () => clock,
    });

    await fetcher("https://claude.ai/doc");
    await fetcher("https://claude.ai/doc");
    clock = 2_000;
    await fetcher("https://claude.ai/doc");

    expect(lookups).toBe(2);
  });
});
