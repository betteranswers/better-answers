import type { ReactElement } from "react";
import type { z } from "zod";

import { RECORD_ID } from "@/features/ask/ask-state.ts";
import { NewQuestionPage } from "@/features/ask/new-question-page.tsx";
import { YourQuestionsPage, YourRecordPage } from "@/features/ask/your-questions-page.tsx";
import { EveryonePage } from "@/features/console/everyone/everyone-page.tsx";
import { NamesWaitingPage } from "@/features/console/names-waiting/names-waiting-page.tsx";
import { WorkspacesPage } from "@/features/console/workspaces-page.tsx";
import { SUGGESTION_ID } from "@/features/inbox/inbox-state.ts";
import { WaitingEditPage } from "@/features/inbox/waiting-edit-page.tsx";
import { WaitingOnYouPage } from "@/features/inbox/waiting-on-you-page.tsx";
import { CollectionsAndOwnersPage } from "@/features/knowledge/collections-and-owners-page.tsx";
import { ConceptPage } from "@/features/knowledge/concept-page.tsx";
import { KnowledgeBasePage } from "@/features/knowledge/knowledge-base-page.tsx";
import { SearchPage } from "@/features/knowledge/search-page.tsx";
import { AuditLogPage } from "@/features/people/audit-log/audit-log-page.tsx";
import { GroupsPage } from "@/features/people/groups/groups-page.tsx";
import { MEMBERS_TOOLBAR, MembersPage } from "@/features/people/members-page.tsx";
import { MemberPage } from "@/features/people/members/member-page.tsx";
import { PERSON_ID } from "@/features/people/members/members-address.ts";
import { AnswerTestsPage } from "@/features/questions/answer-tests-page.tsx";
import { QuestionsAskedPage } from "@/features/questions/questions-asked-page.tsx";
import { ConnectedSourcesPage } from "@/features/sources/connected-sources-page.tsx";
import { CONCEPT_IRI } from "@/shared/knowledge/concept-address.ts";
import { HOMES, type Page, type PagePath } from "@/shared/navigation.ts";
import type { PageToolbar } from "@/shared/page/page-toolbar.tsx";

import { ConnectClaudePage } from "./pages/connect-assistant.tsx";
import { MODELS_AND_SPEND_TOOLBAR, ModelsAndSpendPage } from "./pages/models-and-spend-page.tsx";
import { UnbuiltPage } from "./pages/unbuilt-page.tsx";
import { UnknownPage } from "./pages/unknown-page.tsx";

type BuiltPage = { readonly draw: () => ReactElement; readonly toolbar?: PageToolbar };

const BUILT_PAGES: ReadonlyMap<string, BuiltPage> = new Map<PagePath, BuiltPage>([
  ["/ask/new-question", { draw: NewQuestionPage }],
  ["/ask/your-questions", { draw: YourQuestionsPage }],
  ["/ask/connect-claude", { draw: ConnectClaudePage }],
  ["/knowledge/search", { draw: SearchPage }],
  ["/knowledge/knowledge-base", { draw: KnowledgeBasePage }],
  ["/knowledge/collections-and-owners", { draw: CollectionsAndOwnersPage }],
  ["/inbox/waiting-on-you", { draw: WaitingOnYouPage }],
  ["/sources/connected-sources", { draw: ConnectedSourcesPage }],
  ["/models/models-and-spend", { draw: ModelsAndSpendPage, toolbar: MODELS_AND_SPEND_TOOLBAR }],
  ["/questions/questions-asked", { draw: QuestionsAskedPage }],
  ["/questions/answer-tests", { draw: AnswerTestsPage }],
  ["/people/members", { draw: MembersPage, toolbar: MEMBERS_TOOLBAR }],
  ["/people/groups", { draw: GroupsPage }],
  ["/system/audit-log", { draw: AuditLogPage }],
  ["/console/people/everyone", { draw: EveryonePage }],
  ["/console/people/names-waiting", { draw: NamesWaitingPage }],
  ["/console/workspaces/every-workspace", { draw: WorkspacesPage }],
]);

export type BuiltDetail = {
  readonly value: z.ZodType<string>;
  readonly draw: (value: string | undefined) => ReactElement;
};

const BUILT_DETAILS: ReadonlyMap<string, BuiltDetail> = new Map<PagePath, BuiltDetail>([
  [
    "/ask/your-questions",
    {
      value: RECORD_ID,
      draw: (recordId) => <YourRecordPage recordId={recordId} notFound={<UnknownPage />} />,
    },
  ],
  ["/knowledge/search", { value: CONCEPT_IRI, draw: (iri) => <ConceptPage iri={iri} /> }],
  [
    "/inbox/waiting-on-you",
    {
      value: SUGGESTION_ID,
      draw: (suggestionId) => (
        <WaitingEditPage suggestionId={suggestionId} notFound={<UnknownPage />} />
      ),
    },
  ],
  ["/people/members", { value: PERSON_ID, draw: (personId) => <MemberPage personId={personId} /> }],
]);

const HOME_PAGES: readonly Page[] = Object.values(HOMES);

export const detailOf = (page: Page): BuiltDetail | undefined => {
  const built = BUILT_DETAILS.get(page.path);
  if (page.detail !== undefined && built === undefined) {
    throw new Error(`the list declares an address beneath ${page.path}, and nothing draws it`);
  }
  if (page.detail === undefined && built !== undefined) {
    throw new Error(`something draws an address beneath ${page.path}, and the list declares none`);
  }
  return built;
};

export const drawOf = (page: Page): BuiltPage | undefined => {
  const built = BUILT_PAGES.get(page.path);
  if (page.built && built === undefined) {
    throw new Error(`the list calls ${page.path} built, and nothing draws it`);
  }
  if (!page.built && built !== undefined) {
    throw new Error(`the list calls ${page.path} unbuilt, and something draws it`);
  }
  return (
    built ?? (HOME_PAGES.includes(page) ? { draw: () => <UnbuiltPage home={page} /> } : undefined)
  );
};
