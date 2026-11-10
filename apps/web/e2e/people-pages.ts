import { expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";

import { INVITATION_WORDS } from "@/features/auth/workspace/invitation-words.ts";
import { INVITE_WORDS } from "@/features/people/invitation-words.ts";
import { MEMBER_PAGE_WORDS, SELECTED_MEMBERS } from "@/features/people/member-action-words.ts";
import { CONTROL_CENTRE, menuGroupIn, pageNamed, type Role } from "@/shared/navigation.ts";

import { anAddress, invite, person } from "./harness.ts";

const INVITER = "Morgan Reid";

export const MEMBERS_PAGE = pageNamed(menuGroupIn(CONTROL_CENTRE, "people"), "Members").path;

const MEMBER_PAGE_URL = new RegExp(`${MEMBERS_PAGE}/[0-9A-HJKMNP-TV-Z]{26}$`);

const INVITE = "Invite a Person";

export const membersRegion = (page: Page) => page.getByRole("region", { name: "Members" });

export const outcomeOf = (page: Page): Locator => membersRegion(page).getByRole("status").nth(1);

export const selectionBar = (page: Page): Locator =>
  page.getByRole("toolbar", { name: SELECTED_MEMBERS });

export const memberRows = (page: Page): Locator =>
  membersRegion(page)
    .getByRole("row")
    .filter({ has: page.getByRole("cell") });

export const tickOf = (page: Page, name: string) =>
  membersRegion(page).getByRole("checkbox", { name: `Select ${name}`, exact: true });

export const selectionAction = (page: Page, action: string): Locator =>
  selectionBar(page).getByRole("button", { name: action, exact: true });

export const memberLink = (page: Page, name: string): Locator =>
  membersRegion(page).getByRole("link", { name, exact: true });

export const thePage = (page: Page): Locator => page.getByRole("main");

export const personHeading = (page: Page, name: string): Locator =>
  thePage(page).getByRole("heading", { level: 1, name, exact: true });

export const openedByName = async (page: Page, name: string): Promise<void> => {
  await memberLink(page, name).click();
  await expect(page).toHaveURL(MEMBER_PAGE_URL);
  await expect(personHeading(page, name)).toBeVisible();
};

export const invitationsRegion = (page: Page) => page.getByRole("region", { name: "Invitations" });

export const invitationRows = (page: Page): Locator =>
  invitationsRegion(page).getByRole("row").filter({ hasText: "@" });

export const inviteDialog = (page: Page) => page.getByRole("dialog", { name: INVITE });

export const inviteAction = (page: Page) => page.getByRole("button", { name: INVITE, exact: true });

export const addressField = (page: Page) => inviteDialog(page).getByLabel(INVITE_WORDS.field);

export const everyone = (page: Page) => page.getByRole("region", { name: "Everyone" });

export const personButton = (page: Page, name: string): Locator =>
  everyone(page).getByRole("button", { name, exact: true });

export const sheetOf = (page: Page, name: string): Locator => page.getByRole("dialog", { name });

export const invitationHeading = (page: Page, workspace: string) =>
  page.getByRole("heading", { level: 1, name: INVITATION_WORDS.heading(workspace) });

export const joinButton = (page: Page) => page.getByRole("button", { name: INVITATION_WORDS.join });

export const nameField = (page: Page) => page.getByLabel(MEMBER_PAGE_WORDS.displayName);

export const invitedAs = (page: Page, role: Role) =>
  page
    .getByRole("main")
    .getByRole("paragraph")
    .filter({
      hasText: new RegExp(String.raw`${INVITER}(?:(?!Admin|Editor|Viewer).)*${role}\b`),
    });

export const anInvitation = async (request: APIRequestContext, workspaceId: string, role: Role) => {
  const inviter = await person(request, anAddress("morgan"), { displayName: INVITER });
  const address = anAddress("priya");
  const invited = await invite(request, {
    workspaceId,
    email: address,
    inviterId: inviter.id,
    role,
  });
  return { address, link: `/invitations/${invited.id}` };
};
