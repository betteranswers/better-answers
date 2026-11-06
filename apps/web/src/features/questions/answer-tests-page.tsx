import { CONTROL_CENTRE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";
import { PageHead } from "@/shared/page/page-head.tsx";
import { Card } from "@/shared/ui/card.tsx";
import { EmptyAction } from "@/shared/ui/kibo-ui/empty-action.tsx";

const questions = menuGroupIn(CONTROL_CENTRE, "questions");

const ANSWER_TESTS = pageNamed(questions, "Answer Tests");

const ANSWER_TESTS_WORDS = {
  empty: "No answer tests yet",
  why: "An answer test is made from a correction to an answer. You can’t record corrections yet.",
} as const;

export function AnswerTestsPage() {
  return (
    <>
      <PageHead title={ANSWER_TESTS.name} />
      <Card className="mt-8">
        <EmptyAction title={ANSWER_TESTS_WORDS.empty} description={ANSWER_TESTS_WORDS.why} />
      </Card>
    </>
  );
}
