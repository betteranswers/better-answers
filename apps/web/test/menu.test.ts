import type { ComponentProps } from "react";
import { describe, expectTypeOf, it } from "vitest";

import type { Menu } from "@/app/menu.tsx";
import type { CONTROL_CENTRE, VisibleArea } from "@/shared/navigation.ts";

type Listed = ComponentProps<typeof Menu>["area"];

describe("the menu", () => {
  it("takes an area only as the reader may see it", () => {
    expectTypeOf<VisibleArea>().toExtend<Listed>();
    // @ts-expect-error — an area as declared holds pages the reader may not see.
    expectTypeOf<typeof CONTROL_CENTRE>().toExtend<Listed>();
  });
});
