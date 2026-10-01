import { RadioGroup as RadioGroupPrimitive } from "radix-ui";

import { Pill } from "@/shared/ui/kibo-ui/pill.tsx";
import { RadioGroup } from "@/shared/ui/radio-group.tsx";

export type CountedChoice = {
  value: string;
  label: string;
  count: number;
};

export type CountedSwitchProps = {
  label: string;
  value: string;
  choices: readonly CountedChoice[];
  onValueChange: (value: string) => void;
};

/**
 * The bridge rounds every `role="radio"` fully, so the drawn segment is the inner span and the
 * button underneath stays a bare, square-looking hit area.
 */
export const CountedSwitch = ({ label, value, choices, onValueChange }: CountedSwitchProps) => (
  <RadioGroup
    aria-label={label}
    value={value}
    onValueChange={onValueChange}
    orientation="horizontal"
    className="flex w-fit flex-wrap items-center gap-0.5 bg-muted p-0.5"
  >
    {choices.map((choice) => (
      <RadioGroupPrimitive.Item
        key={choice.value}
        value={choice.value}
        className="group min-h-8 outline-none focus-visible:shadow-none"
      >
        <span className="inline-flex min-h-8 group-focus-visible:shadow-[var(--focus-ring)]">
          {/* Its own span: two shadow utilities on one element set one property, so the checked elevation could hide the focus ring. */}
          <span className="inline-flex min-h-8 items-center gap-1.5 px-2.5 text-sm font-medium text-muted-foreground group-hover:text-foreground group-data-[state=checked]:bg-background group-data-[state=checked]:text-foreground group-data-[state=checked]:shadow-xs">
            {choice.label}{" "}
            <Pill variant="outline" className="px-1.5 py-0 tabular-nums">
              {choice.count}
            </Pill>
          </span>
        </span>
      </RadioGroupPrimitive.Item>
    ))}
  </RadioGroup>
);
