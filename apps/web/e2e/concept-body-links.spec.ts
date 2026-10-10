import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { SEARCH_PAGE as SEARCH } from "@/features/knowledge/concept-address.ts";

import { expect, test } from "./browser.ts";
import {
  addMember,
  anAddress,
  person,
  provision,
  signIn,
  skipLinkReachesThePage,
  tabUntilFocused,
} from "./harness.ts";
import { conceptsSeeded, isAnOpen } from "./knowledge.ts";

const COMMITTEE = "Audit Committee";

const SALARY = "Audit Salary Bands";

const RETENTION = "Audit Logs Retention";

const IRI_PREFIX = "https://better-answers.com/c/";

type Seeded = Awaited<ReturnType<typeof conceptsSeeded>>;

const ulidOf = (concepts: Seeded, title: string): string => {
  const iri = concepts.get(title)?.iri;
  if (iri === undefined) throw new Error(`${title} was not seeded`);
  return iri.slice(IRI_PREFIX.length);
};

const pageOf = (concepts: Seeded, title: string): string =>
  `${SEARCH.path}/${ulidOf(concepts, title)}`;

/** The retention rule's body links the committee and the Restricted salary bands by their files. */
const aRuleLinkingTwo = async (api: APIRequestContext, name: string) => {
  const adminEmail = anAddress("admin");
  const workspace = await provision(api, { name, adminEmail });
  const concepts = await conceptsSeeded(api, {
    workspaceId: workspace.workspaceId,
    userId: workspace.admin.id,
    concepts: [
      { title: COMMITTEE, kind: "Team", body: "The committee meets each quarter." },
      {
        title: SALARY,
        body: "Each salary band is reviewed by the audit committee.",
        sensitivity: "Restricted",
      },
      {
        title: RETENTION,
        body: "We keep audit logs for seven years, then delete them.",
        linksTo: [COMMITTEE, SALARY],
      },
    ],
  });
  return { workspace, adminEmail, concepts };
};

const conceptOf = (page: Page, title: string): Locator =>
  page.getByRole("article", { name: title });

/** The body's own line of links, apart from the page's list of the concept's relations. */
const linkingLine = (page: Page): Locator =>
  conceptOf(page, RETENTION).getByRole("paragraph").filter({ hasText: SALARY });

test.describe("a body's links to other concepts", () => {
  test("an Admin follows a relative link to its concept", async ({ page, request }) => {
    const seeded = await aRuleLinkingTwo(request, "Calder Registry");
    await page.goto("/sign-in");
    await signIn(page, request, seeded.adminEmail);
    await page.goto(pageOf(seeded.concepts, RETENTION));
    const toTheCommittee = linkingLine(page).getByRole("link", { name: COMMITTEE });
    await expect(toTheCommittee).toHaveAttribute("href", pageOf(seeded.concepts, COMMITTEE));
    await expect(linkingLine(page).getByRole("link", { name: SALARY })).toHaveAttribute(
      "href",
      pageOf(seeded.concepts, SALARY),
    );

    await skipLinkReachesThePage(page);
    await tabUntilFocused(page, toTheCommittee);
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(new RegExp(`${pageOf(seeded.concepts, COMMITTEE)}$`));
    await expect(
      conceptOf(page, COMMITTEE).getByRole("heading", { level: 2, name: COMMITTEE }),
    ).toBeVisible();
  });

  test("a Viewer's page holds no address they may not read", async ({ page, request }) => {
    const seeded = await aRuleLinkingTwo(request, "Pendle Registry");
    const email = anAddress("viewer");
    const viewer = await person(request, email, { displayName: "A Viewer" });
    await addMember(request, {
      workspaceId: seeded.workspace.workspaceId,
      userId: viewer.id,
      role: "Viewer",
    });
    await page.goto("/sign-in");
    await signIn(page, request, email);
    const opens: Promise<string>[] = [];
    page.on("response", (response) => {
      if (isAnOpen(new URL(response.url()))) opens.push(response.text());
    });

    await page.goto(pageOf(seeded.concepts, RETENTION));

    const line = linkingLine(page);
    await expect(line.getByRole("link", { name: COMMITTEE })).toHaveAttribute(
      "href",
      pageOf(seeded.concepts, COMMITTEE),
    );
    await expect(line.getByRole("link")).toHaveCount(1);
    await expect(line).toContainText(SALARY);
    const withheld = ulidOf(seeded.concepts, SALARY);
    expect(await page.content(), "the page names the withheld concept").not.toContain(withheld);
    const answers = await Promise.all(opens);
    expect(answers.length, "no knowledge.open answer was read").toBeGreaterThan(0);
    for (const answer of answers) {
      expect(answer, "knowledge.open names the withheld concept").not.toContain(withheld);
    }
  });
});
