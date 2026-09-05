import {
  CatchBoundary,
  RouterContextProvider,
  RouterProvider,
  createMemoryHistory,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FailedScreen } from "@/app/failed-screen.tsx";
import { Providers } from "@/app/providers.tsx";
import { createAppRouter } from "@/app/router.tsx";

/**
 * `[WEB5]`: what a reader is left with when a screen throws, through the router a browser
 * drives (`[TEST1]`: a rendered component through Testing Library where a component's own
 * behaviour is the thing under test). The same failure over the served build, with axe,
 * is `e2e/failed-screen.spec.ts`.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Who the shell says is reading. Only the four fields the frame draws are needed. */
const A_MEMBERSHIP = {
  workspace: { id: "w", name: "Northern Tooling" },
  person: { id: "p", name: "Ada", email: "ada@example.test" },
  role: "Admin",
};

/**
 * What breaks System: the routes read answers a shape its card cannot render — an object
 * where the list should be — so the card throws while it is being drawn rather than
 * showing the failure line it has for a read that was refused.
 *
 * This is the failure the boundary exists for, and the only one a test can cause from
 * outside without mocking our own code (`[TEST3]`): every screen the product has today
 * handles a refusal itself, so a refusal never reaches the boundary. The lie is told at
 * the network, in the browser suite as much as here, and nothing test-only is built into
 * the app to make it possible.
 */
const NOT_A_LIST = { why: "the api answered a shape the routes card cannot render" };

/**
 * The api's answer to a batched tRPC call, in the wire shape the client reads: one entry
 * per procedure named in the path, in that order, and no transformer either side
 * (`apps/api/src/trpc/mount.ts`).
 */
const answerTrpc = (input: string | URL | Request): Promise<Response> => {
  const url = new URL(
    typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    "http://app.test",
  );
  const answers = url.pathname
    .replace("/trpc/", "")
    .split(",")
    .map((procedure) => ({
      result: { data: procedure === "routes.list" ? NOT_A_LIST : A_MEMBERSHIP },
    }));
  return Promise.resolve(
    new Response(JSON.stringify(answers), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
};

/** The tree `main.tsx` mounts, at System, with the routes read answering the shape above. */
const openSystemWithABrokenRead = async () => {
  vi.stubGlobal("fetch", answerTrpc);
  const router = createAppRouter(createMemoryHistory({ initialEntries: ["/system"] }));
  await router.load();
  const rendered = render(
    <Providers>
      <RouterProvider router={router} />
    </Providers>,
  );
  await screen.findByRole("alert");
  return rendered;
};

describe("a screen that throws", () => {
  it("leaves Control Centre's frame, its landmarks and its navigation standing", async () => {
    await openSystemWithABrokenRead();

    expect(screen.getByRole("banner")).toBeDefined();
    expect(screen.getByRole("main")).toBeDefined();
    const navigation = screen.getByRole("navigation", { name: "Control Centre" });
    expect(navigation.textContent).toContain("Knowledge");

    // The failure is inside the shell's outlet, not instead of it: the screen region the
    // skip link reaches is what holds it.
    expect(screen.getByRole("main").contains(screen.getByRole("alert"))).toBe(true);
  });

  it("says the screen could not be shown, and announces it to assistive technology", async () => {
    await openSystemWithABrokenRead();

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "This screen could not be shown",
    );
    // `role="alert"` is the live region: the screen changed under the reader with no
    // control of theirs pressed, so the outcome is spoken rather than only drawn.
    expect(screen.getByRole("alert").textContent).toContain("failed while it was being drawn");
  });

  it("shows a reader nothing of what threw — no message, no name, no stack", async () => {
    const { container } = await openSystemWithABrokenRead();

    // The card threw a `TypeError` reading `.map` off an object. None of that is a reader's:
    // it names the platform's own internals and there is nothing a reader can do with it.
    const shown = container.textContent ?? "";
    expect(shown).not.toContain("map is not a function");
    expect(shown).not.toContain("TypeError");
    expect(shown).not.toContain("Error");
    expect(container.querySelector("pre")).toBeNull();
    // Nothing promises the failure went anywhere: no browser-side logger exists to receive
    // it, so a sentence saying it was reported would be a sentence that is not true.
    expect(shown).not.toMatch(/report|logged|recorded|notified|team/i);
  });

  it("offers the two ways out as controls a keyboard reaches", async () => {
    await openSystemWithABrokenRead();

    const again = screen.getByRole("button", { name: "Try this screen again" });
    // A native control, in the tab order because nothing took it out: the focus ring the
    // design system draws is on it, and Enter and Space operate it without a handler.
    expect(again.tagName).toBe("BUTTON");
    expect(again.getAttribute("tabindex")).toBeNull();
    expect(again.hasAttribute("disabled")).toBe(false);
    again.focus();
    expect(document.activeElement).toBe(again);

    const away = screen.getByRole("link", { name: "Go to System" });
    expect(away.getAttribute("href")).toBe("/system");
  });

  it("draws the screen again when the reader asks for it", () => {
    // A screen that throws while it is broken and draws once it is not, in the boundary the
    // router mounts this component in: `CatchBoundary` with the router's `reset` as the
    // retry, which is exactly what `defaultErrorComponent` is given (the router's
    // `Match.tsx`). The screen is written here rather than added to the app's route tree,
    // because a route that exists for a test is a route the product would ship.
    let broken = true;
    const DrawsWhenItCan = () => {
      if (broken) throw new Error("the screen's own bug");
      return <p>The screen drew.</p>;
    };

    const router = createAppRouter(createMemoryHistory({ initialEntries: ["/system"] }));
    render(
      <RouterContextProvider router={router}>
        <CatchBoundary getResetKey={() => "the reader's own retry"} errorComponent={FailedScreen}>
          <DrawsWhenItCan />
        </CatchBoundary>
      </RouterContextProvider>,
    );

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "This screen could not be shown",
    );

    // The screen would draw now, and nothing draws it: a boundary that has caught stays
    // caught until it is reset, which is what makes the control below the thing under test
    // rather than a button beside a re-render that would have happened anyway.
    broken = false;
    expect(screen.queryByText("The screen drew.")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Try this screen again" }));

    expect(screen.getByText("The screen drew.")).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("leaves an address that is no screen to the screen that already says so", async () => {
    vi.stubGlobal("fetch", answerTrpc);
    const router = createAppRouter(createMemoryHistory({ initialEntries: ["/not-a-screen"] }));
    await router.load();
    render(
      <Providers>
        <RouterProvider router={router} />
      </Providers>,
    );

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("No such screen");
  });
});
