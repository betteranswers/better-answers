import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * The class-name helper every shadcn-registry component calls. It is here because the
 * registries expect it at `aliases.utils` (`components.json`); it is ours in the sense that
 * it lives in this repository, and it does one thing — merge conditional classes and let a
 * later Tailwind utility win over an earlier one of the same kind.
 *
 * A screen still takes its colours, sizes and radii from the design system's tokens through
 * the bridge (ADR 0033); this only decides which utility survives a collision.
 */
export const cn = (...inputs: readonly ClassValue[]) => twMerge(clsx(inputs));
