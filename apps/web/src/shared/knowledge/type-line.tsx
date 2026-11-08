import { CONCEPT_WORDS } from "@/shared/knowledge/concept-words.ts";
import { cn } from "@/shared/lib/utils.ts";

export function TypeLine(properties: {
  readonly type: string | undefined;
  readonly collection?: string;
  readonly className?: string;
}) {
  const parts = [
    { label: CONCEPT_WORDS.type, value: properties.type },
    { label: CONCEPT_WORDS.collection, value: properties.collection },
  ].filter((part) => part.value !== undefined);
  if (parts.length === 0) return null;

  return (
    <dl
      className={cn("flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground", properties.className)}
    >
      {parts.map((part) => (
        <div key={part.label} className="flex min-w-0 gap-1.5">
          <dt>{part.label}</dt>
          <dd className="min-w-0 font-medium wrap-anywhere">{part.value}</dd>
        </div>
      ))}
    </dl>
  );
}
