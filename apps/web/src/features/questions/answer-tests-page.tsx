import { CONTROL_CENTRE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";
import { PageHead } from "@/shared/page/page-head.tsx";
import { Card } from "@/shared/ui/card.tsx";
import { EmptyAction } from "@/shared/ui/kibo-ui/empty-action.tsx";

import { ANSWER_TESTS_WORDS } from "./questions-words.ts";

const questions = menuGroupIn(CONTROL_CENTRE, "questions");

const ANSWER_TESTS = pageNamed(questions, "Answer Tests");

export function AnswerTestsPage() {
  return (
    <>
      <PageHead title={ANSWER_TESTS.name} />
      <Card className="mt-8">
        <EmptyAction title={ANSWER_TESTS_WORDS.empty} />
      </Card>
    </>
  );
}
