import { createTRPCClient } from "@trpc/client";

// A path, not a package: the web already depends on the api, and an edge back is a cycle the
// api's image would install.
import {
  apiLink,
  UPLOAD_HEADER_OF_FIELD,
  uploadOptions,
  type UploadDescriptor,
} from "../../web/src/shared/api/link.ts";
import { TRPC_ENDPOINT } from "../src/trpc/mount.ts";
import type { AppRouter } from "../src/trpc/router.ts";
import type { TestApp, TestClient } from "./harness.ts";
import { signedInClient } from "./provoke.ts";

export { UPLOAD_HEADER_OF_FIELD, uploadOptions, type UploadDescriptor };

type Sent = {
  readonly path: string;

  readonly batched: boolean;
  readonly contentType: string | null;
};

// The web's own link and wrapper, never a copy, so a field renamed on one side alone refuses
// the upload here.
const webClientOf = (client: TestClient) => {
  const sent: Sent[] = [];
  const api = createTRPCClient<AppRouter>({
    links: [
      apiLink({
        url: `${client.origin}${TRPC_ENDPOINT}`,
        fetch: async (url, init) => {
          const asked = new URL(url);
          sent.push({
            path: asked.pathname,
            batched: asked.searchParams.get("batch") === "1",
            contentType: new Headers(init?.headers).get("content-type"),
          });
          return client.fetch(asked.href, {
            method: init?.method ?? "GET",
            headers: new Headers(init?.headers),
            body: init?.body ?? null,
            signal: init?.signal ?? null,
          });
        },
      }),
    ],
  });
  return { api, sent };
};

export const webSignedIn = async (app: TestApp, email: string) => {
  const client = await signedInClient(app, email);
  return { client, ...webClientOf(client) };
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

export const uploadHeaders = (descriptor: UploadDescriptor): Headers => {
  const headers = new Headers(uploadOptions(descriptor).context.upload);
  headers.set("content-type", "application/octet-stream");
  return headers;
};
