import { KNOWLEDGE, menuGroupIn } from "@/shared/navigation.ts";
import { PageHead } from "@/shared/page/page-head.tsx";

const CURATION = menuGroupIn(KNOWLEDGE, "curation");

export function AllKnowledgePage() {
  return <PageHead heading={CURATION.name} summary={CURATION.summary} />;
}
