import type { Context, Hono, MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { z } from "zod";

import { attempt } from "@better-answers/core/kernel";
import { consumeIngress } from "@better-answers/core/store/postgres";
import { hasNoDisplayName } from "@better-answers/core/workspaces";

import {
  countByAddress,
  countingPostsAlone,
  limitByIp,
  tooManyRequests,
} from "../../ingress/limits.ts";
import {
  EMAIL_CODE_LIFETIME_SECONDS,
  EMAIL_CODE_SIGN_IN_IP_RULE,
  SIGN_IN_BY_EMAIL_CODE_PATH,
  SIGN_IN_LINK_COOKIE,
  SIGN_IN_LINK_DESCRIBE_IP_RULE,
  SIGN_IN_LINK_DESCRIBE_PATH,
  SIGN_IN_LINK_PAGE,
  SIGN_IN_LINK_SIGN_IN_IP_RULE,
  SIGN_IN_LINK_SIGN_IN_PATH,
  SIGN_IN_LINK_TOKEN_RULE,
} from "../constants.ts";
import { sameOriginOnly } from "../same-origin.ts";
import {
  forwardCookies,
  callFlow,
  flowHeaders,
  type FlowBody,
  type AuthRoutesDependencies,
} from "./library-flow.ts";
import {
  DEAD_LINK,
  hashOf,
  isBound,
  linkSeen,
  type LinkUse,
  type SeenLink,
  mintNonce,
  shownOf,
  unseal,
} from "./link-token.ts";
import { askingWithALink, dropALink, readALink, signingInByLink } from "./sign-in-link.ts";

const returnPath = z
  .string()
  .max(512)
  .regex(/^\/(?![/\\])[^\\\p{Cc}]*$/u)
  .optional()
  .catch(undefined);

const codeAsk = z
  .object({ type: z.string().optional(), oauth_query: z.string().optional(), redirect: returnPath })
  .catch({});

const secureOrigin = (publicUrl: string): boolean => publicUrl.startsWith("https:");

/** Better Auth drops its own secure prefix on plain http, as the browser suite's loopback is. */
const bindingCookieName = (publicUrl: string): string =>
  secureOrigin(publicUrl) ? `__Host-${SIGN_IN_LINK_COOKIE}` : SIGN_IN_LINK_COOKIE;

export const bindTheLink =
  (publicUrl: string): MiddlewareHandler =>
  async (context, next) => {
    const read = await attempt(() => context.req.raw.clone().json());
    const asked = codeAsk.parse(read.ok ? read.value : {});
    if (asked.type !== "sign-in") {
      await next();
      return;
    }
    const nonce = mintNonce();
    await askingWithALink(
      { nonce, carried: asked.oauth_query ?? "", returnTo: asked.redirect ?? "" },
      next,
    );
    if (!context.res.ok) return;
    setCookie(context, bindingCookieName(publicUrl), nonce, {
      maxAge: EMAIL_CODE_LIFETIME_SECONDS,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      secure: secureOrigin(publicUrl),
    });
  };

const linkToken = z.object({ token: z.string().regex(/^[A-Za-z0-9]{1,128}$/u) });

const tokenOf = async (request: Request): Promise<string | undefined> => {
  const read = await attempt(() => request.json());
  return read.ok ? linkToken.safeParse(read.value).data?.token : undefined;
};

const LINK_REFUSALS = {
  dead: { error: "link-dead" },
  notThisBrowser: { error: "not-this-browser" },
  unanswered: { error: "unanswered" },
} as const;

const SERVER_FAILED = 500;

const linkSignInBody = (use: LinkUse): FlowBody =>
  use.oauthQuery === ""
    ? { email: use.email, otp: use.code }
    : { email: use.email, otp: use.code, oauth_query: use.oauthQuery };

const nameGiven = z.object({ user: z.object({ name: z.string() }) });

/** The library answers a carried flow's next step rather than the person; the next page reads the name. */
const displayNameGivenIn = async (answered: Response): Promise<boolean> => {
  const named = nameGiven.safeParse(
    await answered
      .clone()
      .json()
      .catch(() => undefined),
  );
  return named.success && !hasNoDisplayName(named.data.user.name);
};

export const mountTheSignInLink = (routes: Hono, deps: AuthRoutesDependencies): void => {
  const { auth, door, publicUrl, clock } = deps;

  const ceilingOf = async (
    route: "describe" | "sign-in",
    token: string,
  ): Promise<Response | undefined> => {
    const counted = await consumeIngress(
      door,
      "link",
      `${route}:${hashOf(token)}`,
      SIGN_IN_LINK_TOKEN_RULE,
      clock.now(),
    );
    if (counted.allowed) return undefined;
    return tooManyRequests(
      counted.retryAfterSeconds,
      "Too many tries of this link; try again later.",
    );
  };

  const seen = async (token: string, cookie: string | undefined): Promise<SeenLink> => {
    const read = await readALink(door, token);
    const contents =
      read === undefined ? undefined : unseal(token, deps.secret, hashOf(token), read.sealed);
    return linkSeen(read, contents, read !== undefined && isBound(cookie, read.nonceHash));
  };

  const unanswered = (context: Context, reason: string): Response => {
    deps.logger.warn(
      { event: "auth.link_sign_in_failed", reason },
      "a sign-in through a link went unanswered",
    );
    return context.json(LINK_REFUSALS.unanswered, 502);
  };

  const answerTheSignIn = async (
    context: Context,
    token: string,
    use: LinkUse,
    answered: Response,
  ): Promise<Response> => {
    if (answered.status >= SERVER_FAILED)
      return unanswered(context, `library ${String(answered.status)}`);
    if (!answered.ok) return context.json(LINK_REFUSALS.dead, 410);
    forwardCookies(answered, context.res.headers);
    const dropped = await attempt(() => dropALink(door, token));
    if (!dropped.ok) {
      deps.logger.warn(
        { event: "auth.link_drop_failed", reason: dropped.error.message },
        "a used sign-in link was not deleted",
      );
    }
    return context.json({
      displayNameGiven: await displayNameGivenIn(answered),
      carried: use.carried,
    });
  };

  const signInBy = async (context: Context, token: string, use: LinkUse): Promise<Response> => {
    const counted = await countByAddress(
      deps,
      EMAIL_CODE_SIGN_IN_IP_RULE,
      "email-code-sign-in",
      context.req.raw.headers,
    );
    if (!counted.allowed) {
      return tooManyRequests(
        counted.retryAfterSeconds,
        "Too many sign-ins from this address; try again later.",
      );
    }
    const flowed = await attempt(() =>
      signingInByLink(() =>
        callFlow(
          auth,
          publicUrl,
          SIGN_IN_BY_EMAIL_CODE_PATH,
          flowHeaders(context.req.raw, publicUrl),
          linkSignInBody(use),
        ),
      ),
    );
    if (!flowed.ok) return unanswered(context, flowed.error.message);
    return answerTheSignIn(context, token, use, flowed.value);
  };

  routes.use(SIGN_IN_LINK_PAGE, async (context, next) => {
    await next();
    context.res.headers.set("referrer-policy", "no-referrer");
    context.res.headers.set("cache-control", "no-store");
  });
  routes.use("/sign-in-link/*", sameOriginOnly(publicUrl));
  routes.use(
    SIGN_IN_LINK_DESCRIBE_PATH,
    countingPostsAlone(limitByIp(deps, SIGN_IN_LINK_DESCRIBE_IP_RULE, "sign-in-link-read")),
  );
  routes.use(
    SIGN_IN_LINK_SIGN_IN_PATH,
    countingPostsAlone(limitByIp(deps, SIGN_IN_LINK_SIGN_IN_IP_RULE, "sign-in-link-sign-in")),
  );
  routes.use("/sign-in-link/*", async (context, next) => {
    await next();
    context.res.headers.set("cache-control", "no-store");
  });

  routes.post(SIGN_IN_LINK_DESCRIBE_PATH, async (context) => {
    const token = await tokenOf(context.req.raw);
    if (token === undefined) return context.json(DEAD_LINK);
    const limited = await ceilingOf("describe", token);
    if (limited !== undefined) return limited;
    const link = await seen(token, getCookie(context, bindingCookieName(publicUrl)));
    return context.json(shownOf(link));
  });

  routes.post(SIGN_IN_LINK_SIGN_IN_PATH, async (context) => {
    const token = await tokenOf(context.req.raw);
    if (token === undefined) return context.json(LINK_REFUSALS.dead, 410);
    const limited = await ceilingOf("sign-in", token);
    if (limited !== undefined) return limited;
    const link = await seen(token, getCookie(context, bindingCookieName(publicUrl)));
    if (link.state === "dead") return context.json(LINK_REFUSALS.dead, 410);
    if (link.state === "elsewhere") return context.json(LINK_REFUSALS.notThisBrowser, 403);
    return signInBy(context, token, link.use);
  });
};
