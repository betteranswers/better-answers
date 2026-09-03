import type { ReactNode } from "react";

/**
 * The frame the three screens outside the shell share — sign-in, the picker and the
 * refused screen. They stand outside Control Centre's navigation on purpose: a person
 * reading one of them has no workspace to navigate yet, and a shell around them would
 * offer six screens that would all refuse.
 *
 * WCAG 2.2 AA (`[A11Y1]`): one `main` landmark, one `h1` naming the screen, the DOM order
 * as the keyboard order, and the focus ring the design system draws on every focusable
 * element. Each screen's own outcome is announced by the live region below it.
 */
export function AuthScreen(properties: { readonly title: string; readonly children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="px-4 py-5 md:px-8">
        <p className="font-mono font-medium tracking-tight text-foreground">better-answers</p>
      </header>

      <main id="screen" className="flex-1 px-4 md:px-8">
        <div className="max-w-prose">
          <h1 className="text-xl font-medium">{properties.title}</h1>
          {properties.children}
        </div>
      </main>
    </div>
  );
}

/**
 * What just happened, where a screen reader will hear it: `role="status"` for an outcome
 * the person expected and `role="alert"` for one they did not, both rendered in the flow
 * of the screen rather than over it, so the sentence sits beside the control that caused
 * it (`[UX2]`: a refusal is a decision, and it is said in words).
 */
export function Outcome(properties: {
  readonly tone: "said" | "refused";
  readonly children: ReactNode;
}) {
  return (
    <p
      role={properties.tone === "refused" ? "alert" : "status"}
      className={
        properties.tone === "refused"
          ? "mt-4 border-l-2 border-destructive pl-3 text-destructive"
          : "mt-4 text-muted-foreground"
      }
    >
      {properties.children}
    </p>
  );
}
