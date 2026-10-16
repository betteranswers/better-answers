import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createAppClients, Providers } from "@/app/providers.tsx";
import { WORKSPACES_WORDS } from "@/features/console/list-words.ts";
import { WorkspacesPage } from "@/features/console/workspaces-page.tsx";
import { ModelChoicesCard } from "@/features/model-choices/model-choices-card.tsx";
import { MODEL_CHOICES_WORDS } from "@/features/model-choices/words.ts";
import { EMPTY_LINES } from "@/features/people/empty-lines.ts";
import { GroupsPage } from "@/features/people/groups-page.tsx";
import { Review } from "@/features/sources/review.tsx";
import type { ListedConnectedSource } from "@/features/sources/sources-api.ts";
import { REVIEW_WORDS } from "@/features/sources/words.ts";

import { openPages } from "./address-router.tsx";
import { regionsSeen } from "./regions-seen.tsx";

beforeEach(() => {
  vi.stubGlobal("fetch", () => new Promise<Response>(() => undefined));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const REGION = "[aria-live=polite]";

/** For a loading line the page writes inline, with no constant to hold it to. */
const HOLDS_TEXT = /\S/v;

const mounted = (selector: string, children: ReactNode) => {
  const { seen, Seen } = regionsSeen(selector);
  render(
    <Providers clients={createAppClients()}>
      <Seen>{children}</Seen>
    </Providers>,
  );
  return seen;
};

const A_CONNECTED_SOURCE: ListedConnectedSource = {
  connectedSourceId: z.string().brand<"ConnectedSourceId">().parse("01K5T000000000000000000001"),
  name: "Scans",
  connector: "upload",
  sensitivity: "Internal",
  audience: "everyone",
  audienceGroups: null,
  destination: ["passage-index", "bundle"],
  retentionClass: "keep",
  state: "received",
  publishedAt: null,
  documentCount: 1,
  passageCount: 0,
  lastSync: null,
  unreadable: [],
  unreadableByReason: {},
};

describe("a page's read, said after its region mounts", () => {
  it("fills a loading state beside a refusal line after mount", async () => {
    const { seen, Seen } = regionsSeen("[data-slot='empty-title'] output");
    await openPages(
      {
        "/people/groups": () => (
          <Seen>
            <GroupsPage />
          </Seen>
        ),
      },
      ["/people/groups"],
      function Routed(properties: { readonly children: ReactNode }) {
        return <Providers clients={createAppClients()}>{properties.children}</Providers>;
      },
    );

    expect(seen[0]).toBe("");
    expect(seen.at(-1)).toMatch(HOLDS_TEXT);
    expect(screen.queryByText(EMPTY_LINES.groups)).toBeNull();
  });

  it("fills a region of lines a render after it mounts", () => {
    const seen = mounted(REGION, <ModelChoicesCard />);

    expect(seen[0]).toBe("");
    expect(seen.at(-1)).toBe(MODEL_CHOICES_WORDS.loading);
  });

  it("fills a region drawing one state after mount", () => {
    const seen = mounted(REGION, <WorkspacesPage />);

    expect(seen[0]).toBe("");
    expect(seen.at(-1)).toBe(WORKSPACES_WORDS.loading);
  });

  it("fills a disclosure's region a render after opening mounts it", () => {
    const passages = "[data-slot=collapsible-content] [aria-live=polite]";
    const seen = mounted(passages, <Review connectedSource={A_CONNECTED_SOURCE} />);
    const closed = seen.length;

    fireEvent.click(screen.getByRole("button", { name: "Preview Passages" }));

    const opened = seen.slice(closed);
    expect(seen.slice(0, closed).every((text) => text === undefined)).toBe(true);
    expect(opened[0]).toBe("");
    expect(opened.at(-1)).toMatch(HOLDS_TEXT);
    expect(opened.at(-1)).not.toContain(REVIEW_WORDS.noPassages);
  });
});
