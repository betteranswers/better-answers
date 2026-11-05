import type { ComponentProps } from "react";
import { describe, expectTypeOf, it } from "vitest";

import type { Menu } from "@/app/shell/menu.tsx";
import type { CONTROL_CENTRE, VisibleArea } from "@/shared/navigation.ts";

type MenuArea = ComponentProps<typeof Menu>["area"];

describe("the menu", () => {
  it("accepts only an area filtered to what the reader sees", () => {
    expectTypeOf<VisibleArea>().toExtend<MenuArea>();
    // @ts-expect-error — an unfiltered area includes pages the reader may not see.
    expectTypeOf<typeof CONTROL_CENTRE>().toExtend<MenuArea>();
  });
});
