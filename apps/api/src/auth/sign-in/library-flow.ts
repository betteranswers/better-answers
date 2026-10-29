import type { Logger } from "pino";

import type { Clock } from "@better-answers/core/kernel";
import type { PostgresDoor } from "@better-answers/core/store/postgres";

import type { EmailSender } from "../../email/email.ts";
import type { Auth } from "../auth.ts";

export type AuthRoutesDependencies = {
  readonly auth: Auth;
  readonly door: PostgresDoor;
  readonly publicUrl: string;
  readonly mcpUrl: string;
  readonly logger: Logger;

  readonly clock: Clock;

  readonly secret: string;

  readonly sendEmail: EmailSender;
};

export const oauthQuery = (url: string): string => new URL(url).search.replace(/^\?/u, "");

export const forwardCookies = (from: Response, to: Headers): void => {
  for (const cookie of from.headers.getSetCookie()) to.append("set-cookie", cookie);
};

export const flowHeaders = (request: Request, publicUrl: string): Headers => {
  const headers = new Headers();
  const cookie = request.headers.get("cookie");
  if (cookie !== null) headers.set("cookie", cookie);
  for (const name of ["cf-connecting-ip", "user-agent"]) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }

  headers.set("origin", request.headers.get("origin") ?? publicUrl);
  headers.set("accept", "application/json");
  return headers;
};

export type FlowBody =
  | { readonly postLogin: true; readonly oauth_query: string }
  | { readonly email: string; readonly otp: string; readonly oauth_query?: string };

export const callFlow = (
  auth: Auth,
  publicUrl: string,
  path: string,
  headers: Headers,
  body: FlowBody,
): Promise<Response> => {
  const withJson = new Headers(headers);
  withJson.set("content-type", "application/json");
  return auth.handler(
    new Request(`${publicUrl}${path}`, {
      method: "POST",
      headers: withJson,
      body: JSON.stringify(body),
    }),
  );
};
