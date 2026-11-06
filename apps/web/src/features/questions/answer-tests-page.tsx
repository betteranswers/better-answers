import { useId } from "react";

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
  const headingId = useId();

  return (
    <>
      <PageHead title={ANSWER_TESTS.name} />
      <section aria-labelledby={headingId} className="mt-6">
        <h2 id={headingId} className="sr-only">
          {ANSWER_TESTS.name}
        </h2>
        <Card className="mt-2">
          <EmptyAction title={ANSWER_TESTS_WORDS.empty} description={ANSWER_TESTS_WORDS.why} />
        </Card>
      </section>
    </>
  );
}
