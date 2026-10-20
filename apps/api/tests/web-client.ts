import { createTRPCClient } from "@trpc/client";
import { z } from "zod";

import { TAB_WORKSPACE_HEADER } from "@better-answers/schema/tab-workspace";

import {
  apiLink,
  UPLOAD_HEADER_OF_FIELD,
  uploadOptions,
  type UploadDescriptor,
} from "../../web/src/shared/api/link.ts";
import { TRPC_ENDPOINT } from "../src/trpc/mount.ts";
import type { AppRouter } from "../src/trpc/router.ts";
import { setActiveWorkspace } from "./flow.ts";
import type { TestApp, TestClient } from "./harness.ts";
import { signedInClient } from "./provoke.ts";

export { UPLOAD_HEADER_OF_FIELD, uploadOptions, type UploadDescriptor };

type Sent = {
  readonly path: string;

  readonly batched: boolean;
  readonly contentType: string | null;
};

type LinkInit = Parameters<NonNullable<Parameters<typeof apiLink>[0]["fetch"]>>[1];

const forwarded = (init: LinkInit): RequestInit => ({
  method: init?.method ?? "GET",
  headers: new Headers(init?.headers),
  body: init?.body ?? null,
  signal: init?.signal ?? null,
});

const memberAnswered = z.object({
  result: z.object({ data: z.object({ workspace: z.object({ id: z.string() }) }) }),
});

export const webClientOf = (client: TestClient, held?: string) => {
  const sent: Sent[] = [];
  const api = createTRPCClient<AppRouter>({
    links: [
      apiLink({
        url: `${client.origin}${TRPC_ENDPOINT}`,
        namedWorkspace: {
          forARead: () => held,
          forAWrite: () => held,
          answeredIn: () => undefined,
        },
        fetch: async (url, init) => {
          const asked = new URL(url);
          sent.push({
            path: asked.pathname,
            batched: asked.searchParams.get("batch") === "1",
            contentType: new Headers(init?.headers).get("content-type"),
          });
          return client.fetch(asked.href, forwarded(init));
        },
      }),
    ],
  });
  return { api, sent };
};

export const webTabOf = async (client: TestClient) => {
  const answered = await client.fetch(`${TRPC_ENDPOINT}/session.member`);
  const read = memberAnswered.safeParse(await answered.json());
  return webClientOf(client, read.success ? read.data.result.data.workspace.id : undefined);
};

export const webSignedIn = async (app: TestApp, email: string) => {
  const client = await signedInClient(app, email);
  return { client, ...(await webTabOf(client)) };
};

export const sessionMovedTo = async (client: TestClient, workspaceId: string): Promise<void> => {
  const moved = await setActiveWorkspace(client, workspaceId);
  if (moved.status !== 200) throw new Error(`the switch answered ${moved.status}`);
};

export const aTabLeftBehind = async (
  app: TestApp,
  email: string,
  moved: { readonly from: string; readonly to: string },
) => {
  const client = await signedInClient(app, email);
  await sessionMovedTo(client, moved.from);
  const { api: stale } = await webTabOf(client);
  await sessionMovedTo(client, moved.to);
  return { client, stale };
};

export const anAdminOnTheWeb = async (app: TestApp) => {
  const workspace = await app.provision();
  return { workspace, ...(await webSignedIn(app, workspace.admin.email)) };
};

export const refusalOfCall = (call: Promise<unknown>): Promise<unknown> =>
  call.then(
    () => undefined,
    (refused: unknown) => refused,
  );

const answeredStatus = z.object({ data: z.object({ httpStatus: z.number() }) });

/** An answer with no refusal on it is a success, whose status tRPC does not hand over. */
export const statusOf = async (call: Promise<unknown>): Promise<number> => {
  const refused = answeredStatus.safeParse(await refusalOfCall(call));
  return refused.success ? refused.data.data.httpStatus : 200;
};

export const NO_SESSION_ANSWERED = {
  error: { data: { refusal: { word: "no-session", class: "unauthenticated" } } },
} as const;

export const postedFromATab = (
  client: TestClient,
  path: string,
  body: unknown,
  held: string,
): Promise<Response> =>
  client.fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", [TAB_WORKSPACE_HEADER]: held },
    body: JSON.stringify(body),
  });

export const uploadHeaders = (descriptor: UploadDescriptor, held: string): Headers => {
  const headers = new Headers(uploadOptions(descriptor).context.upload);
  headers.set("content-type", "application/octet-stream");
  headers.set(TAB_WORKSPACE_HEADER, held);
  return headers;
};
