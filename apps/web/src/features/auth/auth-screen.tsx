import type { ReactNode } from "react";

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

export function Outcome(properties: {
  readonly tone: "said" | "refused";
  readonly children: ReactNode;
  readonly id?: string;
}) {
  return (
    <p
      id={properties.id}
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
