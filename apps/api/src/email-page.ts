/** Inline, as a mail client keeps no stylesheet. */
export const PARAGRAPH = "margin:0 0 16px";

/** `title` and `body` are the caller's own markup and fixed phrases, so nothing here is escaped. */
export const emailPage = (title: string, body: string): string => `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;padding:24px;font:16px/1.5 -apple-system,'Segoe UI',system-ui,sans-serif">
${body}
</body></html>`;
