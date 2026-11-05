import { KNOWLEDGE, menuGroupIn } from "@/shared/navigation.ts";
import { PageHead } from "@/shared/page/page-head.tsx";

const CURATION = menuGroupIn(KNOWLEDGE, "curation");

export function KindsPage() {
  return <PageHead heading={CURATION.name} summary={CURATION.summary} />;
}
