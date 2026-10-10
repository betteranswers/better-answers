import { test } from "./fixtures.ts";
import { aMembersJourney } from "./member-journey.ts";

test.use({ role: "Viewer" });

test("a Viewer reaches home and Search, not an Admin's pages", async ({
  page,
  passesTheAccessibilityGate,
}) => {
  await aMembersJourney(page, "Viewer", passesTheAccessibilityGate);
});
