import { test } from "./fixtures.ts";
import { aMembersJourney } from "./member-journey.ts";

test.use({ role: "Editor" });

test("an Editor reaches home and is refused an Admin's pages", async ({
  page,
  passesTheAccessibilityGate,
}) => {
  await aMembersJourney(page, "Editor", passesTheAccessibilityGate);
});
