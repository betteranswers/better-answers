/**
 * The three-region workspace shell the design shows, assembled from its blocks: the icon
 * rail, the toggleable secondary nav that swaps per section, and the toolbar with tabs above
 * the canvas.
 *
 * Registry items needed beyond the installed set: sheet (mobile nav), tooltip, separator.
 * (Below the medium breakpoint the nav is rendered inline under a disclosure rather than in
 * a sheet, so the block works before sheet is installed and still reflows at 320px.)
 *
 * Rules that shaped it: the shell composes, it does not fetch — every region takes typed
 * props and calls typed callbacks, so a screen owns the state. Landmarks are a rail <nav>, a
 * section <nav>, a <header> and a <main>; the skip link is first in the tab order and the
 * DOM order is the keyboard order.
 */
import type { ReactNode } from "react";

import { IconRail, type IconRailProps } from "@/features/workspace/icon-rail.tsx";
import { SectionNav, type SectionNavProps } from "@/features/workspace/section-nav.tsx";
import {
  WorkspaceTopbar,
  type WorkspaceTopbarProps,
} from "@/features/workspace/workspace-topbar.tsx";
import { ViewToolbar, type ViewToolbarProps } from "@/features/workspace/view-toolbar.tsx";

export type WorkspaceShellProps = {
  readonly rail: IconRailProps;
  readonly nav: SectionNavProps;
  readonly topbar: WorkspaceTopbarProps;
  readonly toolbar: ViewToolbarProps;
  readonly children: ReactNode;
};

export function WorkspaceShell({ rail, nav, topbar, toolbar, children }: WorkspaceShellProps) {
  return (
    <div className="flex min-h-screen flex-col bg-background md:h-screen md:flex-row md:overflow-hidden">
      <a
        href="#workspace-canvas"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-card focus:px-3 focus:py-2 focus:text-foreground"
      >
        Skip to the canvas
      </a>

      <IconRail {...rail} />
      <SectionNav {...nav} />

      <main
        id="workspace-canvas"
        tabIndex={-1}
        className="flex min-w-0 flex-1 flex-col md:overflow-hidden"
      >
        <WorkspaceTopbar {...topbar} />
        <ViewToolbar {...toolbar} />
        {children}
      </main>
    </div>
  );
}
