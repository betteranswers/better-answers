import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { anAddress, provision, seedConcepts } from "./harness.ts";

export const QUESTION = "How do buyers access audit information?";

export const USERS = {
  title: "How do buyers access audit information about their users' actions?",
  collection: "audits",
  conceptType: "Answer",
  body: "Buyers download their users' audit log from the console.",
  trust: "machine-confirmed",
} as const;

export const SUPPLIER = {
  title: "How do buyers access audit information about the supplier's actions?",
  collection: "audits",
  conceptType: "Answer",
  body: "The supplier sends its own audit report on request.",
} as const;

export const POLICY = {
  title: "Audit information access for buyers",
  collection: "audits",
  conceptType: "Policy",
  body: "Buyers access audit information through the console's audit page.",
} as const;

const UNFILED = {
  title: "How do buyers access audit information they exported?",
  conceptType: "Answer",
  body: "Exported audit information stays in the buyer's own storage.",
} as const;

export const DRAFTED = "Buyers use the console's audit page.";

export const DRAFTING = { writes: [{ citing: POLICY.title, sentence: DRAFTED }] } as const;

export const anAuditWorkspace = async (api: APIRequestContext) => {
  const adminEmail = anAddress("admin");
  const workspace = await provision(api, { name: "Calder Audits", adminEmail });
  const { workspaceId } = workspace;
  await seedConcepts(api, {
    workspaceId,
    userId: workspace.admin.id,
    concepts: [USERS, SUPPLIER, POLICY, UNFILED],
  });
  return { workspaceId, adminId: workspace.admin.id, adminEmail };
};

export const newQuestion = (page: Page) => page.getByRole("region", { name: "New Question" });

export const questionBox = (page: Page) =>
  newQuestion(page).getByRole("textbox", { name: "Question" });

export const askButton = (page: Page) => newQuestion(page).getByRole("button", { name: "Ask" });

export const answered = (page: Page, verdict: string) =>
  page.getByRole("region", { name: verdict, exact: true });

export const collectionIn = (result: Locator, collection: string) =>
  result.getByRole("region", { name: collection, exact: true });
