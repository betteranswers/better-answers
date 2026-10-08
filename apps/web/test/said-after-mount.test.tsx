import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createAppClients, Providers } from "@/app/providers.tsx";
import { WorkspacesPage } from "@/features/console/workspaces-page.tsx";
import { ModelChoicesCard } from "@/features/model-choices/model-choices-card.tsx";
import { GroupsPage } from "@/features/people/groups-page.tsx";
import { Review } from "@/features/sources/review.tsx";
import type { ListedConnectedSource } from "@/features/sources/sources-api.ts";

import { regionsSeen } from "./regions-seen.tsx";

beforeEach(() => {
  vi.stubGlobal("fetch", () => new Promise<Response>(() => undefined));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const REGION = "[aria-live=polite]";

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
  it("fills a loading region beside a refusal line after mount", () => {
    const seen = mounted(REGION, <GroupsPage />);

    expect(seen[0]).toBe("");
    expect(seen.at(-1)).toBe("The groups are still loading.");
  });

  it("fills a region of lines a render after it mounts", () => {
    const seen = mounted(REGION, <ModelChoicesCard />);

    expect(seen[0]).toBe("");
    expect(seen.at(-1)).toBe("The model choices are still loading.");
  });

  it("fills a region drawing one state after mount", () => {
    const seen = mounted(REGION, <WorkspacesPage />);

    expect(seen[0]).toBe("");
    expect(seen.at(-1)).toBe("The workspaces are still loading.");
  });

  it("fills a disclosure's region a render after opening mounts it", () => {
    const passages = "[data-slot=collapsible-content] [aria-live=polite]";
    const seen = mounted(passages, <Review connectedSource={A_CONNECTED_SOURCE} />);
    const closed = seen.length;

    fireEvent.click(screen.getByRole("button", { name: /Preview the passages/v }));

    const opened = seen.slice(closed);
    expect(seen.slice(0, closed).every((text) => text === undefined)).toBe(true);
    expect(opened[0]).toBe("");
    expect(opened.at(-1)).toBe("The passages are still loading.");
  });
});
