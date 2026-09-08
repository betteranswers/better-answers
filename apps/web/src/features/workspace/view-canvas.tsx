/**
 * The canvas the toolbar's active view renders into: the tile grid from the design — three
 * across on desktop, two on a tablet, one on a phone, with a full-width tile last.
 *
 * Registry items needed beyond the installed set: card, skeleton, tooltip.
 * (A card here is what the register describes rather than what the registry ships: a
 * hairline box on white with a header row, a body, and a sunken footer strip.)
 *
 * Rules that shaped it: no shadow at rest and no hover lift — a hovered tile tints one step
 * and nothing moves; the provenance strip is the sunken surface; the figures are Geist Mono
 * because they are tabular; a loading tile is a hairline box with a `role="status"` label
 * rather than a spinner over the whole screen. Reveal is a 240ms fade with a 4px rise, armed
 * once per tile and skipped entirely under `prefers-reduced-motion`.
 */
import { ArrowDown, ArrowRight, ArrowUp, DotsThree } from "@phosphor-icons/react";

import { Button } from "@/shared/ui/button.tsx";
import { cn } from "@/shared/lib/utils.ts";
import { Outcome } from "@/features/workspace/outcome.tsx";
import { useReveal } from "@/features/workspace/use-reveal.ts";
import type { Identifier, OutcomeMessage, Tile } from "@/features/workspace/types.ts";

export type ViewCanvasProps = {
  readonly heading: string;
  readonly tiles: readonly Tile[];
  readonly outcome?: OutcomeMessage | undefined;
  readonly onOpenTile: (tileId: Identifier) => void;
  readonly onTileMenu: (tileId: Identifier) => void;
};

export function ViewCanvas({ heading, tiles, outcome, onOpenTile, onTileMenu }: ViewCanvasProps) {
  return (
    <section
      aria-label={heading}
      className="flex-1 overflow-y-auto bg-background px-4 py-4 md:px-5 md:py-5"
    >
      <h2 className="sr-only">{heading}</h2>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {tiles.map((tile) => (
          <TileCard key={tile.id} tile={tile} onOpenTile={onOpenTile} onTileMenu={onTileMenu} />
        ))}
      </div>

      {outcome === undefined ? null : <Outcome tone={outcome.tone}>{outcome.text}</Outcome>}
    </section>
  );
}

function TileCard({
  tile,
  onOpenTile,
  onTileMenu,
}: {
  readonly tile: Tile;
  readonly onOpenTile: (tileId: Identifier) => void;
  readonly onTileMenu: (tileId: Identifier) => void;
}) {
  const { ref, shown } = useReveal<HTMLElement>();
  const Trend = tile.trend === "up" ? ArrowUp : tile.trend === "down" ? ArrowDown : ArrowRight;

  return (
    <article
      ref={ref}
      className={cn(
        "flex min-h-49 flex-col border border-border bg-card transition-[opacity,transform,background-color] duration-[240ms] ease-[cubic-bezier(0.2,0,0.13,1)] hover:bg-accent/40",
        tile.span === "full" ? "sm:col-span-2 xl:col-span-3 xl:min-h-72" : "",
        shown ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0",
      )}
    >
      {tile.state === "loading" ? (
        <div className="flex flex-1 flex-col gap-3 p-4">
          <div aria-hidden className="h-3 w-24 bg-muted" />
          <div aria-hidden className="h-7 w-32 bg-muted" />
          <div aria-hidden className="mt-auto h-3 w-full bg-muted" />
          <p role="status" className="sr-only">
            Loading {tile.title}
          </p>
        </div>
      ) : (
        <>
          <div className="flex items-start gap-2 border-b border-border px-4 py-3">
            <div className="min-w-0 flex-1">
              <h3 className="truncate font-medium text-foreground">{tile.title}</h3>
              <p className="truncate text-[11px] tracking-[0.06em] uppercase text-muted-foreground">
                {tile.caption}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              className="shrink-0"
              onClick={() => onTileMenu(tile.id)}
            >
              <DotsThree size={16} color="currentColor" aria-hidden />
              <span className="sr-only">Options for {tile.title}</span>
            </Button>
          </div>

          <div className="flex flex-1 flex-col justify-center gap-2 px-4 py-5">
            <p className="font-mono text-3xl font-semibold tracking-tight text-foreground tabular-nums">
              {tile.metric}
            </p>
            <p
              className={cn(
                "flex items-center gap-1.5 text-sm",
                tile.trend === "down" ? "text-destructive" : "text-muted-foreground",
              )}
            >
              <Trend size={16} color="currentColor" aria-hidden />
              <span className="font-mono tabular-nums">{tile.delta}</span>
              <span>vs. the previous period</span>
            </p>
          </div>

          <div className="flex items-center gap-2 border-t border-border bg-muted px-4 py-2">
            <p className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
              {tile.provenance}
            </p>
            <button
              type="button"
              onClick={() => onOpenTile(tile.id)}
              className="shrink-0 text-sm font-medium text-foreground underline-offset-4 hover:underline"
            >
              Open
              <span className="sr-only"> {tile.title}</span>
            </button>
          </div>
        </>
      )}
    </article>
  );
}
