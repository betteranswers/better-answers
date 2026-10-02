import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createAppClients, Providers } from "@/app/providers.tsx";
import { WorkspacesScreen } from "@/features/console/workspaces-screen.tsx";
import { GroupsScreen } from "@/features/people/groups-screen.tsx";
import { RoutesCard } from "@/features/routes/routes-card.tsx";
import { ROUTES_WORDS } from "@/features/routes/words.ts";
import { Review } from "@/features/sources/review.tsx";
import type { ListedBinding } from "@/features/sources/sources-api.ts";

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

const A_BINDING: ListedBinding = {
  bindingId: z.string().brand<"BindingId">().parse("01K5T000000000000000000001"),
  name: "Scans",
  connector: "upload",
  sensitivity: "Internal",
  audience: "everyone",
  audienceGroups: null,
  destination: ["chunk-index", "bundle"],
  retentionClass: "keep",
  state: "landed",
  publishedAt: null,
  documentCount: 1,
  chunkCount: 0,
  lastRun: null,
  quarantined: [],
  quarantinedByError: {},
};

describe("a screen's read, said after its region mounts (BA-31)", () => {
  it("fills a loading region beside a refusal line after mount", () => {
    const seen = mounted(REGION, <GroupsScreen />);

    expect(seen[0]).toBe("");
    expect(seen.at(-1)).toBe("The groups are still loading.");
  });

  it("fills a region of lines a render after it mounts", () => {
    const seen = mounted(REGION, <RoutesCard />);

    expect(seen[0]).toBe("");
    expect(seen.at(-1)).toBe(ROUTES_WORDS.loading);
  });

  it("fills a region drawing one state after mount", () => {
    const seen = mounted(REGION, <WorkspacesScreen />);

    expect(seen[0]).toBe("");
    expect(seen.at(-1)).toBe("The workspaces are still loading.");
  });

  it("fills a disclosure's region a render after opening mounts it", () => {
    const chunks = "[data-slot=collapsible-content] [aria-live=polite]";
    const seen = mounted(chunks, <Review binding={A_BINDING} />);
    const closed = seen.length;

    fireEvent.click(screen.getByRole("button", { name: /Preview the chunks/v }));

    const opened = seen.slice(closed);
    expect(seen.slice(0, closed).every((text) => text === undefined)).toBe(true);
    expect(opened[0]).toBe("");
    expect(opened.at(-1)).toBe("The chunks are still loading.");
  });
});
