import { KNOWLEDGE, menuGroupIn } from "@/shared/navigation.ts";
import { PageHead } from "@/shared/page-head.tsx";

const CURATION = menuGroupIn(KNOWLEDGE, "curation");

export function CollectionsAndOwnersPage() {
  return <PageHead heading={CURATION.name} summary={CURATION.summary} />;
}
