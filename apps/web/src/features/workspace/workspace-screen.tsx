/**
 * The screen that shows how the blocks compose: it owns the state the shell reports and
 * hands each region its typed props. A real screen would do the same with its own data.
 *
 * Registry items needed beyond the installed set: none of its own.
 *
 * Rule that shaped it: no global state and no fetching — the selected section, the open nav,
 * the active view and the last outcome are plain `useState`, and every callback the shell
 * calls ends in an announced outcome rather than a toast.
 */
import { useMemo, useState } from "react";

import { ViewCanvas } from "@/features/workspace/view-canvas.tsx";
import { WorkspaceShell } from "@/features/workspace/workspace-shell.tsx";
import {
  SAMPLE_NAVS,
  SAMPLE_RAIL,
  SAMPLE_TILES,
  SAMPLE_VIEWER,
  SAMPLE_VIEWS,
  SAMPLE_WORKSPACE,
  SAMPLE_WORKSPACES,
} from "@/features/workspace/sample-data.ts";
import type {
  Identifier,
  SectionNav as SectionNavModel,
  OutcomeMessage,
  ToolbarControl,
  Workspace,
} from "@/features/workspace/types.ts";

export type WorkspaceScreenProps = {
  readonly initialSectionId?: Identifier | undefined;
  readonly initialViewId?: Identifier | undefined;
};

/** The nav for a section, with the people nav as the fallback the index signature needs. */
function navFor(sectionId: Identifier): SectionNavModel {
  const found = SAMPLE_NAVS[sectionId];
  if (found !== undefined) return found;
  const fallback = SAMPLE_NAVS["sec_people"];
  if (fallback === undefined) throw new Error("the sample data has no people section");
  return fallback;
}

export function WorkspaceScreen({
  initialSectionId = "sec_people",
  initialViewId = "view_list",
}: WorkspaceScreenProps) {
  const [sectionId, setSectionId] = useState(initialSectionId);
  const [itemId, setItemId] = useState<Identifier>("nav_react");
  const [viewId, setViewId] = useState(initialViewId);
  const [navOpen, setNavOpen] = useState(true);
  const [search, setSearch] = useState("");
  const [controls, setControls] = useState<readonly ToolbarControl[]>(["sort"]);
  const [workspace, setWorkspace] = useState<Workspace>(SAMPLE_WORKSPACE);
  const [navOutcome, setNavOutcome] = useState<OutcomeMessage | undefined>(undefined);
  const [topOutcome, setTopOutcome] = useState<OutcomeMessage | undefined>(undefined);
  const [canvasOutcome, setCanvasOutcome] = useState<OutcomeMessage | undefined>(undefined);

  const nav = navFor(sectionId);
  const section = SAMPLE_RAIL.find((candidate) => candidate.id === sectionId);
  const view = SAMPLE_VIEWS.find((candidate) => candidate.id === viewId);

  const crumbs = useMemo(
    () => [
      { id: "crumb_home", label: "Home" },
      { id: "crumb_section", label: section?.label ?? "Section" },
      { id: "crumb_view", label: view?.label ?? "View" },
    ],
    [section, view],
  );

  return (
    <WorkspaceShell
      rail={{
        sections: SAMPLE_RAIL,
        activeSectionId: sectionId,
        markLabel: "U",
        onSelectSection: (next) => {
          setSectionId(next);
          const swapped = navFor(next);
          setItemId(swapped.items[0]?.id ?? "");
          setNavOutcome(undefined);
        },
      }}
      nav={{
        workspace,
        workspaces: SAMPLE_WORKSPACES,
        nav,
        activeItemId: itemId,
        open: navOpen,
        outcome: navOutcome,
        onToggleOpen: () => setNavOpen((open) => !open),
        onSelectWorkspace: (nextId) => {
          const next = SAMPLE_WORKSPACES.find((candidate) => candidate.id === nextId);
          if (next === undefined) {
            setNavOutcome({
              tone: "refused",
              text: "That workspace is no longer available to you.",
            });
            return;
          }
          setWorkspace(next);
          setNavOutcome({ tone: "said", text: `Now reading ${next.name} (${next.slug}).` });
        },
        onSelectItem: (nextId) => {
          setItemId(nextId);
          setNavOutcome(undefined);
        },
        onCreateInGroup: (groupId) =>
          setNavOutcome({
            tone: "refused",
            text: `You need an admin role to add to ${groupId === "grp_workspaces" ? "Workspaces" : "Communities"}.`,
          }),
      }}
      topbar={{
        crumbs,
        searchValue: search,
        searchPlaceholder: "Search",
        viewer: SAMPLE_VIEWER,
        outcome: topOutcome,
        onSearchChange: setSearch,
        onOpenReports: () => setTopOutcome({ tone: "said", text: "Reports opened in this view." }),
        onAdd: () => setTopOutcome({ tone: "said", text: "A new item is ready to name." }),
        onOpenViewer: () =>
          setTopOutcome({
            tone: "said",
            text: `Signed in as ${SAMPLE_VIEWER.handle} (${SAMPLE_VIEWER.memberId}).`,
          }),
      }}
      toolbar={{
        views: SAMPLE_VIEWS,
        activeViewId: viewId,
        activeControls: controls,
        onSelectView: setViewId,
        onToggleControl: (control) =>
          setControls((current) =>
            current.includes(control)
              ? current.filter((entry) => entry !== control)
              : [...current, control],
          ),
        onOpenSearch: () => setTopOutcome({ tone: "said", text: "Search is focused." }),
      }}
    >
      <ViewCanvas
        heading={`${section?.label ?? "Section"} — ${view?.label ?? "View"}`}
        tiles={SAMPLE_TILES}
        outcome={canvasOutcome}
        onOpenTile={(tileId) => setCanvasOutcome({ tone: "said", text: `Opened ${tileId}.` })}
        onTileMenu={(tileId) =>
          setCanvasOutcome({ tone: "refused", text: `${tileId} cannot be edited from this view.` })
        }
      />
    </WorkspaceShell>
  );
}
