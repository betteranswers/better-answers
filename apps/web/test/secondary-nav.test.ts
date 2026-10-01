import type { ComponentProps } from "react";
import { describe, expectTypeOf, it } from "vitest";

import type { SecondaryNav } from "@/app/secondary-nav.tsx";
import type { CONTROL_CENTRE, VisibleSurface } from "@/shared/navigation.ts";

type Listed = ComponentProps<typeof SecondaryNav>["surface"];

describe("the secondary nav", () => {
  it("takes a surface only as the reader may see it", () => {
    expectTypeOf<VisibleSurface>().toExtend<Listed>();
    // @ts-expect-error — a surface as declared holds screens the reader may not see.
    expectTypeOf<typeof CONTROL_CENTRE>().toExtend<Listed>();
  });
});
