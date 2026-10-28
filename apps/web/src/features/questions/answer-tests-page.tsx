import { useId } from "react";

import { CONTROL_CENTRE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";
import { PageHead } from "@/shared/page/page-head.tsx";
import { Card } from "@/shared/ui/card.tsx";
import { EmptyAction } from "@/shared/ui/kibo-ui/empty-action.tsx";

const questions = menuGroupIn(CONTROL_CENTRE, "questions");

const ANSWER_TESTS = pageNamed(questions, "Answer Tests");

const ANSWER_TESTS_WORDS = {
  empty: "No answer tests yet",
  why: "Each correction recorded becomes an answer test. Recording corrections is coming soon.",
} as const;

export function AnswerTestsPage() {
  const headingId = useId();

  return (
    <>
      <PageHead heading={questions.name} summary={questions.summary} />
      <section aria-labelledby={headingId} className="mt-6">
        <h2 id={headingId}>{ANSWER_TESTS.name}</h2>
        <Card className="mt-2">
          <EmptyAction title={ANSWER_TESTS_WORDS.empty} description={ANSWER_TESTS_WORDS.why} />
        </Card>
      </section>
    </>
  );
}
