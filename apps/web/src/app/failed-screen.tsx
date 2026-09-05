import { Link } from "@tanstack/react-router";

import { Button } from "@/shared/ui/button.tsx";

/**
 * A screen that threw while it was being drawn. The router mounts it in place of the route
 * that threw and no higher, so a screen under the shell is replaced inside the frame's
 * outlet and the reader loses one screen rather than the product. The three screens outside
 * the frame — sign-in, the picker, the refused screen — carry their own landmark, so a throw
 * in one of them leaves this standing alone; that is the same page the no-such-screen
 * component has always been, and better than the blank the router's own default drew.
 *
 * The router hands an error component the error, its component stack and a reset. This one
 * takes the reset alone: a message, a name or a stack is the platform's own internals, and
 * a reader — Viewer, Editor or Admin — can do nothing with any of it. It is in the
 * browser's console and its network log for whoever is looking there. Nothing here says the
 * failure was reported, because there is nowhere for it to be reported to: a browser-side
 * logger is a decision of its own and has not been taken.
 *
 * What happened, then the way out: `reset` draws the screen again, which is the whole of the
 * fix when what threw was a read that answered badly once. The way to System beside it is
 * the same escape the no-such-screen page offers, for the failure that repeats.
 *
 * WCAG 2.2 AA, tested with a keyboard and a screen reader: the sentence is a live region,
 * because the screen changed under the reader with no control of theirs pressed, and both
 * ways out are native controls in the DOM order.
 */
export function FailedScreen(properties: { readonly reset: () => void }) {
  return (
    <>
      <h1>This screen could not be shown</h1>
      <p role="alert" className="mt-2 text-muted-foreground">
        Something in it failed while it was being drawn. The rest of Control Centre is still here,
        and the other screens can be read as usual.
      </p>

      <p className="mt-6">
        <Button type="button" onClick={properties.reset}>
          Try this screen again
        </Button>
      </p>

      <p className="mt-4">
        <Link to="/system" className="text-brand underline">
          Go to System
        </Link>
      </p>
    </>
  );
}
