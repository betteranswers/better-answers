import type { Page } from "@playwright/test";
import { z } from "zod";

/** A batch's address names its procedures in the order of its answers; a call sent alone names one. */
export const askedAt = (url: string): readonly string[] =>
  new URL(url).pathname.replace("/trpc/", "").split(",");

const aRefusedCall = z.object({
  error: z.object({
    data: z.object({
      httpStatus: z.number(),
      refusal: z
        .object({
          word: z.string(),
          class: z.string(),
          items: z.record(z.string(), z.string()).optional(),
        })
        .optional(),
      retryAfterSeconds: z.number().optional(),
    }),
  }),
});

export const refusalAnswering = async (page: Page, procedure: string) => {
  const answered = await page.waitForResponse((answer) =>
    askedAt(answer.url()).includes(procedure),
  );
  const answers: unknown = await answered.json();
  const batch = z.array(z.unknown()).safeParse(answers);
  const answer = batch.success ? batch.data[askedAt(answered.url()).indexOf(procedure)] : answers;
  const refused = aRefusedCall.safeParse(answer);
  if (!refused.success) throw new Error(`the api did not refuse ${procedure}`);
  const { httpStatus, refusal, retryAfterSeconds } = refused.data.error.data;
  return { status: httpStatus, ...refusal, waitSeconds: retryAfterSeconds };
};

export const aCeilingMet = (waitSeconds: number) => ({
  status: 429,
  headers: { "retry-after": String(waitSeconds) },
  json: { error: "too_many_requests", error_description: "Too many requests." },
});

export const theNextAskMeetsACeiling = (page: Page, path: string, waitSeconds: number) =>
  page.route(
    (url) => url.pathname === path,
    (route) => route.fulfill(aCeilingMet(waitSeconds)),
    { times: 1 },
  );

const aRefusalOutsideTrpc = z.object({ code: z.string().optional(), error: z.string().optional() });

const wholeSeconds = z.coerce.number().int().optional();

export const authAnswering = async (page: Page, path: string) => {
  const answered = await page.waitForResponse((answer) => new URL(answer.url()).pathname === path);
  if (answered.ok()) throw new Error(`the api did not refuse ${path}`);
  const { code, error } = aRefusalOutsideTrpc.parse(await answered.json());
  return {
    status: answered.status(),
    code,
    word: error,
    waitSeconds: wholeSeconds.parse(answered.headers()["retry-after"]),
  };
};
