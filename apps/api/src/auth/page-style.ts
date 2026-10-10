import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { serveStatic } from "@hono/node-server/serve-static";
import type { Hono } from "hono";

const STYLES = fileURLToPath(import.meta.resolve("@better-answers/design-system/styles.css"));

/** An inline sheet resolves no relative `@import`: the browser would ask this origin for `/tokens/…`. */
const expanded = (file: string): string =>
  readFileSync(file, "utf8").replace(/^@import "(\.\/[^"]+)";$/gm, (_line, relative: string) =>
    expanded(path.resolve(path.dirname(file), relative)),
  );

/** The faces the design system depends on, resolved from it because the api does not list them. */
const fromDesignSystem = createRequire(STYLES);

const FACES = [
  { pkg: "@fontsource-variable/geist", mount: "/fonts/geist" },
  { pkg: "@fontsource-variable/geist-mono", mount: "/fonts/geist-mono" },
].map(({ pkg, mount }) => {
  const sheet = fromDesignSystem.resolve(pkg);
  return {
    mount,
    files: path.join(path.dirname(sheet), "files"),
    css: readFileSync(sheet, "utf8").replaceAll("url(./files/", `url(${mount}/`),
  };
});

/** Unlayered, so it outranks the pattern rule: set `background-color` there, never the shorthand, which clears the pattern's image. */
const PAGE_RULES = `
*,::before,::after{box-sizing:border-box}
html{font-family:var(--font-sans);font-size:var(--text-base);line-height:var(--leading-normal);letter-spacing:var(--tracking-body);color:var(--text-body)}
body{margin:0;min-height:100vh;display:flex;flex-direction:column;background-color:var(--surface-page)}
body>header{display:flex;align-items:center;gap:var(--space-2);padding:var(--space-5) var(--space-4);font-family:var(--font-mono);font-size:var(--text-lg);font-weight:var(--weight-medium);letter-spacing:var(--tracking-display);color:var(--text-primary)}
body>header svg{display:block;width:var(--space-6);height:var(--space-6)}
main{flex:1;padding:0 var(--space-4) var(--space-16)}
[data-slot=card]{margin:var(--space-4) auto 0;width:100%;max-width:var(--measure-prose);border:var(--border-width) solid var(--border-subtle);background-color:var(--surface-card);color:var(--text-primary)}
[data-slot=card-header]{padding:var(--space-4) var(--space-4) 0}
h1{margin:0;font-size:var(--text-xl);font-weight:var(--weight-medium);letter-spacing:var(--tracking-heading)}
[data-slot=card-content]{padding:var(--space-4)}
p{margin:0}p+p{margin-top:var(--space-2)}
ul{margin:var(--space-4) 0;padding-left:var(--space-5)}li+li{margin-top:var(--space-1)}
strong{font-weight:var(--weight-semibold)}
a{color:var(--text-link);text-underline-offset:var(--space-1)}a:hover{color:var(--text-link-hover)}
[data-slot=actions]{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-2);margin-top:var(--space-6)}
button{display:inline-flex;align-items:center;justify-content:center;height:var(--space-8);padding:0 var(--space-4);border:var(--border-width) solid transparent;border-radius:var(--radius-md);font:inherit;font-size:var(--text-sm);font-weight:var(--weight-medium);white-space:nowrap;cursor:pointer}
button[data-variant=default]{--mark-ink:var(--accent-300);background-color:var(--control-primary-bg);color:var(--control-primary-fg)}
button[data-variant=default]:hover{background-color:var(--control-primary-bg-hover)}
button[data-variant=default]:active{background-color:var(--control-primary-bg-active)}
button[data-variant=outline]{border-color:var(--border-default);background-color:var(--surface-page);color:inherit;box-shadow:var(--shadow-xs)}
button[data-variant=outline]:hover{background-color:var(--surface-hover)}
button[data-variant=outline]:active{background-color:var(--surface-active)}
:is(button,a):focus-visible{outline:none;box-shadow:var(--focus-ring)}
/* Tailwind's md, which no token carries. */
@media (min-width:48rem){body>header,main{padding-inline:var(--space-8)}[data-slot=card]{margin-top:var(--space-16)}}
`;

/** One sheet per process: the design system's, the faces at this tier's mounts, then the page's rules. */
export const PAGE_STYLE = [expanded(STYLES), ...FACES.map((face) => face.css), PAGE_RULES].join(
  "\n",
);

/** The face files the sheet names, ahead of the catch-all that would otherwise answer them. */
export const serveFaces = (server: Hono): void => {
  for (const face of FACES) {
    server.get(
      `${face.mount}/*`,
      serveStatic({
        root: face.files,
        rewriteRequestPath: (requested) => requested.slice(face.mount.length),
      }),
    );
  }
};
