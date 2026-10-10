import { useId } from "react";

import { chooseTheme, useThemeChoice, type ThemeChoice } from "@/shared/theme.ts";
import { Label } from "@/shared/ui/label.tsx";
import { RadioGroup, RadioGroupItem } from "@/shared/ui/radio-group.tsx";

import { THEME_WORDS } from "./account-words.ts";

const CHOICES: readonly ThemeChoice[] = ["device", "light", "dark"];

const choiceOf = (value: string): ThemeChoice | undefined =>
  CHOICES.find((choice) => choice === value);

/** Applied as it is picked: the page itself shows what the choice did. */
export function ThemeSection() {
  const choice = useThemeChoice();
  const id = useId();
  const headingId = `${id}-heading`;
  const keptId = `${id}-kept`;

  return (
    <section aria-labelledby={headingId} className="mt-8">
      <h2 id={headingId}>{THEME_WORDS.heading}</h2>
      <RadioGroup
        aria-labelledby={headingId}
        aria-describedby={keptId}
        value={choice}
        onValueChange={(value) => {
          const picked = choiceOf(value);
          if (picked !== undefined) chooseTheme(picked);
        }}
        className="mt-3"
      >
        {CHOICES.map((each) => (
          <div key={each} className="flex items-center gap-3">
            <RadioGroupItem id={`${id}-${each}`} value={each} />
            <Label htmlFor={`${id}-${each}`}>{THEME_WORDS[each]}</Label>
          </div>
        ))}
      </RadioGroup>
      <p id={keptId} className="mt-3 text-sm text-muted-foreground">
        {THEME_WORDS.kept}
      </p>
    </section>
  );
}
