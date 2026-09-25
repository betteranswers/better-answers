import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { publishBinding, publishBindingInput } from "@better-answers/core/sources";
import {
  bindTheHandbook,
  locatorOf,
  THE_ACCOUNT_NUMBER,
  THE_PASSAGE,
  THE_QUERY,
  THE_SORT_CODE,
  THE_TITLE,
  THE_WITHHELD_SPAN,
} from "@better-answers/core/testing/cross-tier";
import { inputOf } from "@better-answers/core/testing/input";
import { objectStoreForSuite } from "@better-answers/core/testing/objects";
import { runWorkerOnce } from "@better-answers/core/testing/worker-process";

import { connectAsHost } from "./flow.ts";
import { actingIn, startApp, type TestApp } from "./harness.ts";
import { calledTool, rendered, structured } from "./mcp-call.ts";

let app: TestApp;

const store = objectStoreForSuite();

beforeAll(async () => {
  app = await startApp();
}, 180_000);

afterAll(async () => {
  await app.stop();
});

const A_CROSS_TIER_ALLOWANCE_MS = 300_000;

const PUBLISHED_AT = new Date("2026-09-23T09:00:00.000Z");

const CONFIRMED = {
  lawfulBasisRecorded: true,
  privacyInformationUpdated: true,
  dpiaReferenced: true,
} as const;

describe("one uploaded document, read back over the MCP surface", () => {
  it(
    "finds and opens the landed passage, its sort code withheld",
    async () => {
      const workspace = await app.provision();
      const viewer = await app.person();
      await app.addMember(workspace.workspaceId, viewer.id, "Viewer");

      const who = { workspaceId: workspace.workspaceId, userId: workspace.admin.id };
      const admin = await actingIn(app, who, async (principal) => principal);
      const bound = await bindTheHandbook(admin, {
        postgres: app.doors.postgres,
        objects: store().door,
      });

      await runWorkerOnce(app.database.connectionUri, app.gitStoreDir, "mcp-cross-tier", store());
      await actingIn(app, who, (principal, tx) =>
        publishBinding(principal, tx, {
          ...inputOf(publishBindingInput, {
            bindingId: bound.bindingId,
            confirmations: CONFIRMED,
          }),
          publishedAt: PUBLISHED_AT,
        }),
      );

      const locator = locatorOf(bound.documentId, THE_WITHHELD_SPAN);
      const client = app.client();
      const token = (
        await connectAsHost(app, client, viewer, { scope: "knowledge:read offline_access" })
      ).accessToken;

      const found = await calledTool(client, token, "find", { query: THE_QUERY });
      const opened = await calledTool(client, token, "open", { locator });

      expect(structured(found)["hits"]).toEqual([
        {
          layer: "sources",
          kind: "document",
          title: THE_TITLE,
          locator,
          sensitivity: "Internal",
        },
      ]);
      expect(rendered(found)).toBe(
        `document · ${THE_TITLE} · Not company knowledge · Internal · ${locator}`,
      );
      expect(structured(opened)).toEqual({
        found: true,
        passage: {
          locator,
          source: THE_TITLE,
          text: THE_PASSAGE,
          sensitivity: "Internal",
        },
      });
      expect(rendered(opened)).toBe(`> ${THE_PASSAGE}\n\n— ${THE_TITLE} (${locator}) · Internal`);
      expect(JSON.stringify(opened)).not.toContain(THE_SORT_CODE);
      expect(JSON.stringify(opened)).not.toContain(THE_ACCOUNT_NUMBER);
    },
    A_CROSS_TIER_ALLOWANCE_MS,
  );
});
