/** `an Admin`, `an Editor`, `a Viewer`: a role as a sentence names it. */
export const aRole = (role: string): string => `${role === "Viewer" ? "a" : "an"} ${role}`;
