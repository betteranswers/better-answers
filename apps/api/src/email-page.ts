/** Text a person typed, made safe to stand in a page's markup. */
export const escaped = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/** `3 March 2026`, as a UK reader writes a day, on the UK's own clock. */
export const LONG_UK_DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Europe/London",
});

/** Inline, as a mail client keeps no stylesheet. */
export const PARAGRAPH = "margin:0 0 16px";

/** `title` and `body` are the caller's own markup and fixed phrases, so nothing here is escaped. */
export const emailPage = (title: string, body: string): string => `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;padding:24px;font:16px/1.5 -apple-system,'Segoe UI',system-ui,sans-serif">
${body}
</body></html>`;
