import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, assert, describe, expect, it, vi } from "vitest";

import { AREAS, pagesOf, placeAt, readerOf, visibleTo } from "@/shared/navigation.ts";
import { openApp } from "@test/open-app.tsx";
import { answeringAs } from "@test/stubbed-api.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const BUILT = pagesOf(AREAS).filter((page) => page.built);

describe("the menu's current page", () => {
  it.each(BUILT.map((page) => [page.path, page] as const))(
    "marks only %s as current when it is open",
    async (_path, page) => {
      vi.stubGlobal("fetch", answeringAs("Admin"));
      const area = placeAt(visibleTo(readerOf("Admin"), AREAS).areas, page.path)?.area;
      assert(area !== undefined, "the page is in no area an Admin can see");

      await openApp(page.path);

      const menu = screen.getByRole("navigation", { name: area.name });
      expect(
        within(menu)
          .getAllByRole("link", { current: "page" })
          .map((link) => link.textContent),
      ).toEqual([page.name]);
    },
  );
});
